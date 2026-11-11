#!/usr/bin/env node
// Konveyer ishchisi — yangi qo'ng'iroqlarni o'zi topib tahlildan o'tkazadi (TZ §6).
//
//   node call-worker.mjs             — bir sikl ishlaydi va chiqadi (cron shunday chaqiradi)
//   node call-worker.mjs --dry       — nima qilishini ko'rsatadi, hech narsa qilmaydi
//   node call-worker.mjs --limit 5   — shu siklda nechta qo'ng'iroq
//   node call-worker.mjs --days 3    — qancha kun orqaga qaraydi
//
// Nega bir sikl: uzoq ishlaydigan demon emas, cron chaqiradigan qisqa ish.
// Osilib qolsa keyingi chaqiruvda o'zi tiklanadi, qulf esa ustma-ust ketishni to'sadi.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

// Loyiha papkasi: SOTUV_APP yoki shu faylning ota papkasi (lokal va serverda bir xil ishlaydi).
const APP = process.env.SOTUV_APP || path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const lib = (name) => pathToFileURL(path.join(APP, "lib", name)).href;
// Kalitlar: loyihaning .env (Bitrix vebxuki, GEMINI_API_KEY). Qolgan fayllar — serverdagi eski joylar,
// bo'lmasa o'tkazib yuboriladi. claude-oauth.env faqat Claude zaxirasi (CALLAI_CLAUDE_FALLBACK=1) uchun.
for (const f of ["/home/claude/secrets/bitrix-sotuv.env", path.join(APP, ".env"),
                 "/home/claude/.claude-qongiroq/channels/telegram/.env", "/home/claude/secrets/claude-oauth.env"]) {
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const { Bitrix } = await import(lib("bitrix.mjs"));
const calls = await import(lib("calls.mjs"));
const store = await import(lib("callstore.mjs"));
const pipe  = await import(lib("pipeline.mjs"));
const dir   = await import(lib("directory.mjs"));
const stt   = await import(lib("stt.mjs"));

const arg = (name, def) => {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const DRY = process.argv.includes("--dry");
const LIMIT = Math.max(1, Math.min(50, Number(arg("limit", 8))));
const DAYS = Math.max(1, Math.min(366, Number(arg("days", 3))));
// --yangidan: eng yangi qo'ng'iroqdan boshlab (eski qo'ng'iroqlar zaxirasi uchun — yangisi muhimroq)
const YANGIDAN = process.argv.includes("--yangidan");
// --faqat-sifat: faqat lid sifati (AI) bosqichi — transkripsiya navbatiga tegmaydi (qo'lda to'ldirish uchun)
const FAQAT_SIFAT = process.argv.includes("--faqat-sifat");

const db = new DatabaseSync(process.env.SOTUV_DB || path.join(APP, "data", "sotuv.db"));
db.exec("PRAGMA busy_timeout = 8000;");
store.initCallSchema(db);
const bx = new Bitrix(process.env.BITRIX_WEBHOOK_URL, { timeoutMs: 30000 });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- oldindan tekshiruv: nima yetishmayotganini aniq aytamiz ----
const caps = await dir.capabilities(bx);
// Audio: telephony scope or, without it, the recording file on Bitrix Disk (caps.recordings covers both)
if (!caps.recordings) {
  log("TO'XTADI: Bitrix webhook'da «Телефония» ham, «Диск» ham yo'q — audio olinmaydi.");
  log("Biri yoqilgach bu ishchi o'zi ishlay boshlaydi, kodga tegish shart emas.");
  process.exit(0);
}
if (!stt.available()) { log("TO'XTADI: GROQ_API_KEY topilmadi — nutqdan matnga ishlamaydi."); process.exit(1); }

// ---- navbatni yig'amiz ----
const reg = await calls.registry(bx, db, { range: DAYS, limit: 5000, canSeePhone: true });
const queue = [];
const skipped = {};
for (const c of reg.rows) {
  const chk = pipe.shouldProcess(db, c);
  if (chk.ok) queue.push(c);
  else skipped[chk.why] = (skipped[chk.why] || 0) + 1;
}
// Odatda eng eskisidan (navbat orqada qolib ketmasin); --yangidan bo'lsa eng yangisidan
queue.sort((a, b) => (YANGIDAN ? new Date(b.at) - new Date(a.at) : new Date(a.at) - new Date(b.at)));

log(`${DAYS} kun · ${reg.rows.length} qo'ng'iroq · navbatda ${queue.length} · shu siklda ${Math.min(LIMIT, queue.length)}`);
for (const [why, n] of Object.entries(skipped)) log(`   o'tkazildi (${n}): ${why}`);

if (DRY) {
  for (const c of queue.slice(0, LIMIT))
    log(`   [quruq] #${c.id} ${c.at.slice(0, 16)} ${c.dur}s ${c.out ? "chiq" : "kir"} — ${(c.entity?.title || "—").slice(0, 30)}`);
  process.exit(0);
}

let ok = 0, fail = 0, skip = 0, limitda = false;
for (const c of FAQAT_SIFAT ? [] : queue.slice(0, LIMIT)) {
  try {
    const r = await pipe.processCall(bx, db, c, { actor: "worker" });
    if (r.rateLimited) { limitda = true; log(`   #${c.id} Groq soatlik audio limiti — sikl to'xtatildi, qo'ng'iroq navbatda qoladi`); break; }
    // Gemini (bepul tarif) hamma modeli limitda/band — sikl to'xtaydi, qo'ng'iroqlar navbatda qoladi
    if (r.deferred) { limitda = true; log(`   #${c.id} navbatda qoldi: ${String(r.why).slice(0, 220)}`); break; }
    if (r.skipped) { skip++; log(`   #${c.id} o'tkazildi: ${r.why}`); }
    else if (r.failed) { fail++; log(`   #${c.id} XATO [${r.stage}]: ${r.why}`); }
    else {
      ok++;
      log(`   #${c.id} tayyor — ball ${r.score}, xavf ${r.risk}, ${Math.round(r.ms / 1000)}s · ${r.steps.join(" → ")}`);
      if (r.aiError) log(`      (AI qatlami ishlamadi: ${r.aiError})`);
    }
  } catch (e) {
    fail++;
    log(`   #${c.id} KUTILMAGAN XATO: ${e.message}`);
  }
}
// ---- Sifatni yangilash (2026-09-24): Groq'da o'girilgan VoIP transkriptlarini Gemini bilan qayta ----
// Faqat yangi qo'ng'iroqlar navbatidan keyin va Gemini kvotasi qolgan bo'lsa. Groq'ga HECH QACHON
// tushmaydi (geminiOnly). Xodim qo'lda tuzatgan transkriptga tegmaydi (edited_by bor bo'lsa).
let upg = 0;
const UPG = Math.max(0, Number(process.env.WORKER_UPGRADE ?? 3));
if (!limitda && !FAQAT_SIFAT && UPG && stt.geminiOn && stt.geminiOn()) {
  const eski = db.prepare(`SELECT t.call_id FROM call_transcripts t JOIN call_analyses a ON a.call_id = t.call_id
      WHERE t.call_id LIKE 'v%' AND (t.source IS NULL OR t.source NOT LIKE 'stt:gemini%') AND t.edited_by IS NULL
        AND a.status = 'ready' ORDER BY CAST(substr(t.call_id, 2) AS INTEGER) DESC LIMIT ?`).all(UPG * 3).map((r) => r.call_id);
  for (const id of eski) {
    if (upg >= UPG) break;
    const c = reg.rows.find((x) => String(x.id) === String(id));
    if (!c || !c.hasRecording) continue;
    try {
      const r = await pipe.processCall(bx, db, c, { force: true, actor: "worker-gemini", geminiOnly: true });
      if (r.deferred) { log(`   sifatni yangilash to'xtadi: ${String(r.why).slice(0, 160)}`); break; }
      if (r.failed) { log(`   #${c.id} yangilash XATO [${r.stage}]: ${String(r.why).slice(0, 160)}`); continue; }
      upg++;
      log(`   #${c.id} Gemini bilan yangilandi — ball ${r.score} · ${r.steps.join(" → ").slice(0, 200)}`);
    } catch (e) { log(`   #${c.id} yangilash KUTILMAGAN XATO: ${e.message}`); }
  }
}
// ---- AI tahlilni yangilash (2026-09-25, egasi: «iloji boricha Gemini») ----
// Claude zaxirasida tahlil qilingan yoki Gemini band bo'lgani uchun AI'siz (faqat qoida) qolgan UZUN qo'ng'iroqlar
// (≥ PIPE_AI_SEC) Gemini bilan qayta tahlil qilinadi. Transkript tayyor — faqat matn so'rovi (flash-lite).
let aiUpg = 0;
const AI_UPG = Math.max(0, Number(process.env.WORKER_AI_UPGRADE ?? 3));
if (!limitda && !FAQAT_SIFAT && AI_UPG && stt.geminiOn && stt.geminiOn()) {
  const { runAnalysis } = await import(lib("callrun.mjs"));
  const gem = await import(lib("gemini.mjs"));
  const AI_SEC = Number(process.env.PIPE_AI_SEC || 90);
  const nomzod = [];
  for (const r of db.prepare(`SELECT call_id, json, engine FROM call_analyses WHERE status = 'ready' AND call_id LIKE 'v%' ORDER BY CAST(substr(call_id, 2) AS INTEGER) DESC`).all()) {
    let j = null; try { j = JSON.parse(r.json); } catch { continue; }
    const eng = String(j.aiEngine || "");
    const claude = eng === "claude" || (!eng && r.engine === "ai+rules");
    const aiYoq = !eng && r.engine === "rules" && !!j.aiError;          // Gemini band bo'lgan — AI qismi yo'q
    if (claude || aiYoq) nomzod.push(r.call_id);
    if (nomzod.length >= AI_UPG * 5) break;
  }
  for (const id of nomzod) {
    if (aiUpg >= AI_UPG || !gem.freeModels().length) break;
    const c = reg.rows.find((x) => String(x.id) === String(id));
    if (!c || (c.dur || 0) < AI_SEC) continue;
    try {
      const r = await runAnalysis(db, c.id, { call: c, dealId: c.deal?.id || null }, { useAi: true, force: true, actor: "worker-gemini" });
      if (r.analysis?.aiEngine && String(r.analysis.aiEngine).startsWith("gemini")) { aiUpg++; log(`   #${c.id} AI tahlil Gemini bilan yangilandi (${r.analysis.aiEngine})`); }
      else { log(`   AI tahlilni yangilash to'xtadi: ${String(r.aiError || "Gemini band").slice(0, 160)}`); break; }
    } catch (e) { log(`   #${c.id} AI tahlilni yangilash XATO: ${String(e.message).slice(0, 160)}`); }
  }
}
// ---- Lid sifati (AI, 2026-09-24): transkripti bor lidlarga «sifatli / sifatsiz / noaniq» ----
// Egasi: «sifatli lidni AI o'zi aniqlasin» (kunlik hisobot, TZ 1.1). Bir so'rovda SIFAT_BATCH ta lid —
// bepul Gemini kvotasi tejaladi. Eng yangi qo'ng'irog'i bor liddan boshlab; lidga yangi transkript
// qo'shilsa (basis o'zgaradi) — qayta baholanadi. Gemini limitda bo'lsa — keyingi siklda.
const sifat = await import(lib("sifat.mjs"));
sifat.initSifat(db);
let sifatN = 0, sifatNavbat = 0;
const SIF_BATCH = Math.max(1, Math.min(10, Number(process.env.SIFAT_BATCH || 6)));
const SIF_MAX = Math.max(0, Number(process.env.SIFAT_PER_CYCLE ?? 2));          // shu siklda nechta so'rov
const SIF_DAYS = Math.max(1, Number(process.env.SIFAT_DAYS || 45));
// Egasi 2026-09-25: «iloji boricha Gemini». Claude zaxirasi standart O'CHIQ (SIFAT_CLAUDE=1 bilan yoqiladi).
const SIF_CLAUDE = Math.max(0, Number(process.env.SIFAT_CLAUDE ?? 0));
let sifClaude = 0;
if (!limitda && SIF_MAX && stt.geminiOn && stt.geminiOn()) {
  const chegara = Date.now() - SIF_DAYS * 864e5;
  const byLead = new Map();
  for (const c of reg.rows) {
    const lid = c.entity && (c.entity.kind === "lead" || c.entity.kind === "deal") ? String(c.entity.id) : null;
    if (!lid || !(new Date(c.at).getTime() >= chegara)) continue;
    const tr = store.getTranscript(db, c.id); if (!tr) continue;
    const arr = byLead.get(lid) || []; arr.push({ id: String(c.id), at: c.at, out: !!c.out, text: tr.text }); byLead.set(lid, arr);
  }
  const navbat = [];
  for (const [lead, arr] of byLead) {
    arr.sort((a, b) => new Date(b.at) - new Date(a.at));
    const calls = arr.slice(0, 4);                                   // eng yangi 4 ta suhbat yetarli
    const basis = sifat.basisOf(calls);
    if (sifat.needs(db, lead, basis)) navbat.push({ lead, calls, basis, last: calls[0].at });
    else if (sifat.geminiEmas(db, lead)) navbat.push({ lead, calls, basis, last: calls[0].at, qayta: true });   // Claude'da baholangan
  }
  // Avval yangi/o'zgargan lidlar (eng yangi qo'ng'irog'i bo'yicha), keyin Claude'da baholanganlar
  navbat.sort((a, b) => (!!a.qayta - !!b.qayta) || new Date(b.last) - new Date(a.last));
  sifatNavbat = navbat.length;
  for (let i = 0; i < SIF_MAX && i * SIF_BATCH < navbat.length; i++) {
    const batch = navbat.slice(i * SIF_BATCH, (i + 1) * SIF_BATCH);
    try {
      const r = await sifat.classify(batch, { claude: sifClaude < SIF_CLAUDE });
      if (r.engine === "claude") sifClaude++;
      const bor = new Set();
      for (const row of r.rows) {
        const b = batch.find((x) => x.lead === row.lead); if (!b) continue;
        sifat.save(db, row, b.basis, b.calls.map((c) => c.id), r.engine); bor.add(row.lead); sifatN++;
      }
      // AI javobida tushib qolgan lid navbatni to'sib qo'ymasin — «noaniq» sifatida belgilanadi
      for (const b of batch) if (!bor.has(b.lead)) sifat.save(db, { lead: b.lead, verdict: "noaniq", reason: "AI bu lidga javob bermadi", quote: null, callId: null, signals: {} }, b.basis, b.calls.map((c) => c.id), r.engine);
      log(`   lid sifati: ${r.rows.length}/${batch.length} baholandi (${r.engine}${r.gemXato ? " — Gemini band/limitda" : ""}) — ${r.rows.map((x) => `#${x.lead} ${x.verdict}`).join(", ").slice(0, 200)}`);
    } catch (e) { log(`   lid sifati to'xtadi: ${String(e.message).slice(0, 200)}`); break; }
  }
}
log(`yakun: tayyor ${ok}, xato ${fail}, o'tkazildi ${skip}, navbatda qoldi ${Math.max(0, queue.length - ok - fail - skip)}${upg ? `, Gemini'ga yangilandi ${upg}` : ""}${aiUpg ? `, AI tahlil Gemini'ga ${aiUpg}` : ""}${sifatN || sifatNavbat ? `, lid sifati ${sifatN} (navbat ${Math.max(0, sifatNavbat - sifatN)})` : ""}${limitda ? " · limit (Groq yoki Gemini)" : ""}`);
process.exit(0);
