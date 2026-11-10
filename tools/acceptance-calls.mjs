#!/usr/bin/env node
// TZ §12 qabul testi: N ta REAL qo'ng'iroqni audiodan tahlilgacha o'tkazadi va
// ikki xil natija beradi:
//   1) AVTOMAT o'lchovlar — muvaffaqiyat foizi, vaqt, uydirma urinishlari, til taqsimoti
//   2) TEKSHIRUV VARAQASI — odam to'ldiradigan HTML; §12 dagi "85% aniqlik" va
//      "90% kritik xavfni o'tkazib yubormaslik" faqat shundan hisoblanadi.
//
// Foydalanish (serverda, sotuv-web papkasida):
//   node tools/acceptance-calls.mjs run   [--n 30] [--days 30] [--dry]
//   node tools/acceptance-calls.mjs score  <toldirilgan.json>
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Bitrix } from "../lib/bitrix.mjs";
import * as calls from "../lib/calls.mjs";
import * as cstore from "../lib/callstore.mjs";
import * as crun from "../lib/callrun.mjs";
import * as cllm from "../lib/callllm.mjs";
import * as tel from "../lib/telephony.mjs";
import * as stt from "../lib/stt.mjs";
import * as dir from "../lib/directory.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, "..");
for (const f of [path.join(ROOT, ".env"), "/home/claude/secrets/bitrix-sotuv.env",
                 "/home/claude/secrets/telegram-sotuv.env", "/home/claude/secrets/telegram-qoriqchi.env"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes("--" + k);
const OUT = path.join(ROOT, "data", "acceptance");
const bx = new Bitrix(process.env.BITRIX_WEBHOOK_URL);
const db = new DatabaseSync(process.env.SOTUV_DB || path.join(ROOT, "data", "sotuv.db"));
// Web servisi ayni paytda shu bazaga yozayotgan bo'lishi mumkin — kutamiz,
// aks holda "database is locked" bilan yiqilamiz (sinovda shunday bo'ldi).
db.exec("PRAGMA busy_timeout = 8000;");
cstore.initCallSchema(db);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------------------------------------------------------- namuna tanlash
// Har operatordan, turli uzunlikda — bir kishining bir kunlik ishi emas.
async function pick(n, days) {
  const reg = await calls.registry(bx, db, { range: days, limit: 5000, canSeePhone: true });
  const ok = reg.rows.filter((r) => !r.missed && r.hasRecording && r.dur >= 30);
  const byOwner = new Map();
  for (const r of ok) { if (!byOwner.has(r.owner)) byOwner.set(r.owner, []); byOwner.get(r.owner).push(r); }
  for (const list of byOwner.values()) list.sort((a, b) => b.dur - a.dur);
  const out = [];
  let i = 0;
  while (out.length < n) {                      // navbat bilan har operatordan
    let added = false;
    for (const list of byOwner.values()) if (list[i]) { out.push(list[i]); added = true; if (out.length >= n) break; }
    if (!added) break;
    i++;
  }
  return { picked: out, pool: ok.length, total: reg.rows.length, caps: reg.caps };
}

// ---------------------------------------------------------------- yurgizish
async function run() {
  const n = Math.min(200, Math.max(1, Number(arg("n", 30))));
  const days = Math.min(366, Math.max(1, Number(arg("days", 30))));
  fs.mkdirSync(OUT, { recursive: true });
  const caps = await dir.capabilities(bx);
  console.log(`Ruxsatlar: telephony=${caps.telephony} names=${caps.names} tasks=${caps.tasks} | STT=${stt.available()} | AI=${cllm.available()}`);
  const { picked, pool, total } = await pick(n, days);
  console.log(`Namuna: ${picked.length} ta (${pool} mos qo'ng'iroqdan, jami ${total}); ${days} kun`);
  if (has("dry")) {
    for (const r of picked) console.log(" ", r.id, r.at.slice(0, 16), String(r.ownerName).padEnd(8), (r.dur + "s").padStart(6), (r.entity?.title || "").slice(0, 42));
    console.log(`\n(sinov rejimi — hech narsa ishlanmadi). telephony=${caps.telephony} STT=${stt.available()}`);
    return;
  }
  if (!caps.telephony) {
    console.error("\nTO'XTADI: «Телефония» ruxsati yo'q — audio olinmaydi.");
    console.error("Bitrix24 → Ilovalar → Ishlab chiquvchilar uchun → webhook → «Телефония» katagini belgilang.\n");
    process.exit(2);
  }
  if (!stt.available()) { console.error("TO'XTADI: GROQ_API_KEY yo'q"); process.exit(2); }

  const rows = [];
  for (const [i, r] of picked.entries()) {
    const t0 = Date.now();
    const row = { id: r.id, at: r.at, owner: r.ownerName || r.owner, durSec: r.dur,
                  client: r.entity?.title || null, deal: r.deal?.title || null };
    process.stdout.write(`[${i + 1}/${picked.length}] ${r.id} … `);
    try {
      const act = await bx.call("crm.activity.get", { id: r.id }).then((x) => x.result).catch(() => null);
      const rec = await tel.record(bx, { originId: act?.ORIGIN_ID, at: r.at, phone: r.phone });
      if (rec.error) throw new Error("yozuv: " + rec.error);
      const s = await stt.transcribe(rec.url, { outgoing: r.out, aiDiarize: cllm.diarize });
      row.stt = { ms: s.meta.ms, method: s.meta.method, language: s.meta.language,
                  segments: s.segments.length, speakersAssumed: s.speakersAssumed, chars: s.text.length };
      cstore.putTranscript(db, r.id, s.text, { source: "stt", lang: s.meta.language, actor: "qabul-testi" });
      const a = await crun.runAnalysis(db, r.id, { dealId: r.deal?.id || null }, { force: true, actor: "qabul-testi" });
      const j = a.analysis;
      row.analysis = { engine: j.engine, score: j.operator_score.total, risk: j.deal_risk.level,
                       sentiment: j.sentiment.overall, urgency: j.urgency.level, topic: j.topic,
                       summary: j.summary, confidence: j.confidence,
                       dropped: j.droppedByGuard.length, aiError: j.aiError || null,
                       criticalMoments: j.critical_moments.filter((m) => m.speaker === "customer").length,
                       nextAction: j.next_action?.text || null,
                       problems: (j.problems || []).map((p) => p.title),
                       objections: (j.objections || []).map((o) => o.text) };
      row.transcript = s.text;
      row.totalMs = Date.now() - t0;
      row.ok = true;
      console.log(`ok · ${Math.round(row.totalMs / 1000)}s · ball ${row.analysis.score} · ${row.analysis.risk}`);
    } catch (e) {
      row.ok = false; row.error = e.message; row.totalMs = Date.now() - t0;
      console.log("XATO: " + e.message.slice(0, 90));
    }
    rows.push(row);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const jf = path.join(OUT, `natija-${stamp}.json`);
  fs.writeFileSync(jf, JSON.stringify({ createdAt: new Date().toISOString(), days, n: picked.length, rows }, null, 2));
  const hf = path.join(OUT, `tekshiruv-${stamp}.html`);
  fs.writeFileSync(hf, sheet(rows, stamp));
  summary(rows);
  console.log(`\nNatija: ${jf}\nTekshiruv varaqasi: ${hf}`);
  console.log("Varaqani to'ldirib saqlagach:  node tools/acceptance-calls.mjs score <to'ldirilgan.json>");
}

// ---------------------------------------------------------------- avtomat o'lchovlar
function summary(rows) {
  const ok = rows.filter((r) => r.ok);
  const p = (n, d) => (d ? Math.round(n / d * 100) : 0);
  const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
  console.log("\n===== AVTOMAT O'LCHOVLAR =====");
  console.log(`Ishlangan            : ${ok.length}/${rows.length} (${p(ok.length, rows.length)}%)`);
  if (!ok.length) return;
  const times = ok.map((r) => r.totalMs / 1000);
  console.log(`Vaqt (median/eng uzun): ${Math.round(med(times))}s / ${Math.round(Math.max(...times))}s   — TZ §10 maqsadi 120 s`);
  console.log(`120 s ichida ulgurgan : ${p(times.filter((t) => t <= 120).length, times.length)}%`);
  const meth = {}; for (const r of ok) meth[r.stt.method] = (meth[r.stt.method] || 0) + 1;
  console.log(`Spiker ajratish      : ${JSON.stringify(meth)}  (stereo-split = aniq)`);
  const lang = {}; for (const r of ok) lang[r.stt.language] = (lang[r.stt.language] || 0) + 1;
  console.log(`Til                  : ${JSON.stringify(lang)}`);
  console.log(`AI qatlami ishladi   : ${p(ok.filter((r) => r.analysis.engine === "ai+rules").length, ok.length)}%`);
  const dropped = ok.reduce((a, r) => a + r.analysis.dropped, 0);
  console.log(`Uydirma to'sildi     : ${dropped} ta da'vo (${ok.filter((r) => r.analysis.dropped).length} suhbatda)`);
  const risk = {}; for (const r of ok) risk[r.analysis.risk] = (risk[r.analysis.risk] || 0) + 1;
  console.log(`Xavf taqsimoti       : ${JSON.stringify(risk)}`);
  const sc = ok.map((r) => r.analysis.score);
  console.log(`Ball (median/min/max): ${med(sc)} / ${Math.min(...sc)} / ${Math.max(...sc)}`);
  const noNext = ok.filter((r) => !r.analysis.nextAction).length;
  console.log(`Keyingi qadamsiz     : ${noNext} ta (${p(noNext, ok.length)}%)`);
  if (rows.some((r) => !r.ok)) {
    console.log("\nXatolar:");
    for (const r of rows.filter((x) => !x.ok)) console.log(`  ${r.id}: ${r.error}`);
  }
}

// ---------------------------------------------------------------- tekshiruv varaqasi
function sheet(rows, stamp) {
  const ok = rows.filter((r) => r.ok);
  const Q = [
    ["summary", "Qisqa xulosa suhbatga mos"],
    ["problem", "Muammo to'g'ri aniqlangan"],
    ["client", "Mijoz/kompaniya ma'lumoti to'g'ri (yoki haqli ravishda bo'sh)"],
    ["objection", "E'tirozlar to'g'ri aniqlangan"],
    ["next", "Keyingi qadam to'g'ri"],
    ["speakers", "Spikerlar to'g'ri ajratilgan"],
  ];
  return `<!doctype html><meta charset="utf-8"><title>Qabul testi — ${esc(stamp)}</title>
<style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:1000px;margin:0 auto;padding:24px;color:#111}
h1{font-size:20px} h2{font-size:15px;margin:0 0 4px}
.card{border:1px solid #ddd;border-radius:10px;padding:14px;margin:14px 0}
.meta{color:#666;font-size:12px;margin-bottom:8px}
pre{background:#f7f7f9;padding:10px;border-radius:8px;max-height:220px;overflow:auto;white-space:pre-wrap;font-size:12px}
label{display:inline-flex;gap:5px;align-items:center;margin-right:14px;font-size:13px}
.q{margin:3px 0}
.bar{position:sticky;bottom:0;background:#fff;border-top:1px solid #ddd;padding:12px 0;margin-top:20px}
button{font:inherit;padding:8px 16px;border-radius:8px;border:1px solid #333;background:#111;color:#fff;cursor:pointer}
.note{background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:10px;font-size:13px}
</style>
<h1>TZ §12 qabul testi — ${esc(stamp)}</h1>
<div class="note"><b>Qanday to'ldiriladi:</b> har bir qo'ng'iroq uchun audioni Bitrix24'da eshiting,
so'ng quyidagi savollarga javob bering. «Kritik» degani — suhbatda mijozni yo'qotish xavfi bor edi
(sud, shikoyat, bekor qilish, ishonchsizlik, raqobatchiga ketish). Oxirida «Saqlash» tugmasini bosing —
fayl yuklanadi, uni <code>score</code> buyrug'iga bering.</div>
${ok.map((r, i) => `
<div class="card" data-id="${esc(r.id)}">
  <h2>${i + 1}. ${esc(r.client || "—")} <span class="meta">#${esc(r.id)}</span></h2>
  <div class="meta">${esc(r.at.slice(0, 16))} · ${esc(r.owner)} · ${r.durSec}s ·
    ${esc(r.stt.language)} · ${esc(r.stt.method)}${r.stt.speakersAssumed ? " (spikerlar taxminiy)" : ""}</div>
  <div><b>AI xulosasi:</b> ${esc(r.analysis.summary || "—")}</div>
  <div class="meta">Mavzu: ${esc(r.analysis.topic || "—")} · Ball: ${r.analysis.score}/100 ·
    Xavf: <b>${esc(r.analysis.risk)}</b> · Kayfiyat: ${esc(r.analysis.sentiment)}</div>
  <div class="meta">Muammolar: ${esc(r.analysis.problems.join("; ") || "—")}</div>
  <div class="meta">E'tirozlar: ${esc(r.analysis.objections.join("; ") || "—")}</div>
  <div class="meta">Keyingi qadam: ${esc(r.analysis.nextAction || "—")}</div>
  <details><summary>Transkript</summary><pre>${esc(r.transcript)}</pre></details>
  ${Q.map(([k, lab]) => `<div class="q">${lab}:
    <label><input type="radio" name="${r.id}_${k}" value="1"> ha</label>
    <label><input type="radio" name="${r.id}_${k}" value="0"> yo'q</label>
    <label><input type="radio" name="${r.id}_${k}" value="na" checked> tegishli emas</label></div>`).join("")}
  <div class="q" style="margin-top:8px"><b>Suhbatda kritik xavf bor edimi?</b>
    <label><input type="radio" name="${r.id}_wasCritical" value="1"> ha</label>
    <label><input type="radio" name="${r.id}_wasCritical" value="0" checked> yo'q</label></div>
</div>`).join("")}
<div class="bar"><button onclick="save()">Saqlash (JSON yuklab olish)</button></div>
<script>
function save(){
  const out={filledAt:new Date().toISOString(),rows:[]};
  document.querySelectorAll(".card").forEach(c=>{
    const id=c.dataset.id,o={id:id};
    c.querySelectorAll("input:checked").forEach(i=>{o[i.name.slice(id.length+1)]=i.value});
    out.rows.push(o);
  });
  const b=new Blob([JSON.stringify(out,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="tekshiruv-${esc(stamp)}-toldirilgan.json";a.click();
}
</script>`;
}

// ---------------------------------------------------------------- baholash
function score() {
  const f = process.argv[3];
  if (!f || !fs.existsSync(f)) { console.error("Foydalanish: node tools/acceptance-calls.mjs score <to'ldirilgan.json>"); process.exit(1); }
  const filled = JSON.parse(fs.readFileSync(f, "utf8"));
  const runs = fs.readdirSync(OUT).filter((x) => x.startsWith("natija-")).sort();
  if (!runs.length) { console.error("natija-*.json topilmadi"); process.exit(1); }
  const res = JSON.parse(fs.readFileSync(path.join(OUT, runs[runs.length - 1]), "utf8"));
  const byId = new Map(res.rows.map((r) => [r.id, r]));

  const FIELDS = ["summary", "problem", "client", "objection", "next", "speakers"];
  let yes = 0, no = 0;
  let critTotal = 0, critCaught = 0;
  for (const r of filled.rows) {
    for (const k of FIELDS) {
      if (r[k] === "1") yes++;
      else if (r[k] === "0") no++;
    }
    if (r.wasCritical === "1") {
      critTotal++;
      const a = byId.get(r.id);
      if (a && ["critical", "high"].includes(a.analysis?.risk)) critCaught++;
    }
  }
  const acc = yes + no ? Math.round(yes / (yes + no) * 100) : null;
  const recall = critTotal ? Math.round(critCaught / critTotal * 100) : null;
  const P = (v, lim) => (v === null ? "o'lchanmadi" : `${v}%  ${v >= lim ? "✅ o'tdi" : "❌ o'tmadi"} (kerak ≥${lim}%)`);
  console.log("\n===== TZ §12 QABUL MEZONLARI =====");
  console.log(`Tekshirilgan qo'ng'iroq : ${filled.rows.length} ${filled.rows.length >= 30 ? "✅" : "❌ (kerak ≥30)"}`);
  console.log(`Maydonlar aniqligi      : ${P(acc, 85)}   [${yes} to'g'ri / ${yes + no} baholangan]`);
  console.log(`Kritik xavfni ushlash   : ${P(recall, 90)}   [${critCaught}/${critTotal}]`);
  const byField = {};
  for (const k of FIELDS) {
    let y = 0, n = 0;
    for (const r of filled.rows) { if (r[k] === "1") y++; else if (r[k] === "0") n++; }
    byField[k] = y + n ? Math.round(y / (y + n) * 100) + "%" : "—";
  }
  console.log(`\nMaydon kesimida         : ${JSON.stringify(byField)}`);
  const pass = filled.rows.length >= 30 && acc >= 85 && recall !== null && recall >= 90;
  console.log(`\nYAKUN: ${pass ? "✅ QABUL QILINDI" : "❌ hali qabul mezonlariga yetmadi"}`);
}

const cmd = process.argv[2];
if (cmd === "run") await run();
else if (cmd === "score") score();
else { console.log("node tools/acceptance-calls.mjs run [--n 30] [--days 30] [--dry]\nnode tools/acceptance-calls.mjs score <fayl.json>"); }
