#!/usr/bin/env node
// Qo'ng'iroq tahlili — agent uchun so'rov vositasi.
//
// Agent raqamni O'YLAB TOPMASLIGI uchun: har javob bazadan keladi va qaysi davr
// olingani ochiq yoziladi. Ma'lumot yo'q bo'lsa "yo'q" deb aytadi, taxmin qilmaydi.
//
//   qongiroq-cli.mjs kpi [kun]            — umumiy ko'rsatkichlar
//   qongiroq-cli.mjs kritik [kun]         — kritik/yuqori xavfli suhbatlar
//   qongiroq-cli.mjs reyting [kun]        — operatorlar reytingi
//   qongiroq-cli.mjs mezon [kun]          — 8 mezon bo'yicha jamoa
//   qongiroq-cli.mjs operator <id> [kun]  — bitta operator kesimi
//   qongiroq-cli.mjs etiroz [kun]         — eng ko'p e'tiroz va muammolar
//   qongiroq-cli.mjs qongiroq <id>        — bitta suhbatning to'liq tahlili
//   qongiroq-cli.mjs tahlilsiz [kun]      — tahlil kutayotganlar
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execSync } from "node:child_process";

const APP = process.env.SOTUV_APP || "/home/claude/projects/sotuv-web";
for (const f of ["/home/claude/secrets/bitrix-sotuv.env", path.join(APP, ".env")]) {
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const db = new DatabaseSync(process.env.SOTUV_DB || path.join(APP, "data", "sotuv.db"));
db.exec("PRAGMA busy_timeout = 8000;");

const [cmd, ...rest] = process.argv.slice(2);
const days = () => { const n = Number(rest.find((x) => /^\d+$/.test(x))); return Number.isFinite(n) && n > 0 ? Math.min(n, 366) : 30; };
const out = [];
const say = (s = "") => out.push(s);
const fin = () => { console.log(out.join("\n")); process.exit(0); };
const RISK = { critical: "KRITIK", high: "yuqori", medium: "o'rta", low: "past" };
const SENT = { positive: "ijobiy", neutral: "neytral", negative: "salbiy" };

// DAVR — QO'NG'IROQ SANASI bo'yicha (2026-09-23). Ilgari tahlil sanasi (analyzed_at) olinardi:
// fevral–iyul qo'ng'iroqlari shu hafta tahlil qilingani uchun agentlar ularni majlisda «oxirgi 7 kun»
// deb hisobot berdi. Endi davrdagi qo'ng'iroqlar CRM'dan (adapter — faqat SUN-HIGHTECH) olinadi va
// faqat shularning tahlili hisoblanadi. Get-Green qo'ng'iroqlari ro'yxatga umuman kirmaydi.
const URL_CRM = String(process.env.BITRIX_WEBHOOK_URL || "");
const crm = (method, body) => JSON.parse(execSync(
  `curl -s -m 40 ${JSON.stringify(URL_CRM + method + ".json")} -H "Content-Type: application/json" -d ${JSON.stringify(JSON.stringify(body))}`,
  { encoding: "utf8", maxBuffer: 32e6 }));
const tkSana = (iso) => { const t = new Date(iso); return Number.isNaN(t.getTime()) ? "—"
  : new Date(t.getTime() + 5 * 3600e3).toISOString().slice(0, 16).replace("T", " "); };
// Oyna matni: skript «oxirgi N kun» deb yozardi, lekin filtr `Date.now() - d*864e5`,
// ya'ni siljiydigan N×24 soat, yuqori chegarasi yo'q. Podpis kalendar kun deb o'qilib,
// agent ishonch bilan xato qilardi (11:36 da skript 906, panel kalendar kecha 1019).
// Oyna hisobi O'ZGARMAYDI — faqat podpis haqiqatni aytadi.
const oyna = (d) => `oxirgi ${d}×24 soat, hozirdan orqaga: ${tkSana(Date.now() - d * 864e5)} — ${tkSana(Date.now())} (Asia/Tashkent; kalendar kun EMAS)`;
const _davr = new Map();
const davrQongiroqlari = (d) => {          // [{ID, CREATED, RESPONSIBLE_ID, SETTINGS}] yoki null (CRM javob bermasa)
  if (_davr.has(d)) return _davr.get(d);
  let res = null;
  if (URL_CRM) {
    try {
      const dan = new Date(Date.now() - d * 864e5).toISOString();
      const list = []; let start = 0;
      for (let k = 0; k < 400; k++) {
        const r = crm("crm.activity.list", { filter: { TYPE_ID: 2, ">=CREATED": dan },
          select: ["ID", "CREATED", "RESPONSIBLE_ID", "SETTINGS"], start });
        list.push(...(r.result || []));
        if (r.next === undefined || !(r.result || []).length) break;
        start = r.next;
      }
      res = list;
    } catch { res = null; }
  }
  _davr.set(d, res);
  return res;
};
// Eng oxirgi qo'ng'iroq (adapter /healthz) — davr bo'sh bo'lsa sababini aytish uchun
const oxirgiQongiroq = () => { try {
  const h = JSON.parse(execSync(`curl -s -m 8 ${JSON.stringify(URL_CRM.replace(/\/rest\/.*$/, "/healthz"))}`, { encoding: "utf8" }));
  return h?.counts?.callsOxirgi || null; } catch { return null; } };
let _qamrov = null;                        // {davrda, javobsiz, tahlil} — sarlavhaga
const rows = (d) => {
  const calls = davrQongiroqlari(d);
  const tayyor = db.prepare(`SELECT call_id, score, risk, sentiment, topic, urgency, engine, analyzed_at, json
                             FROM call_analyses WHERE status='ready'`).all();
  if (!calls) {                            // CRM javob bermadi — tahlil sanasi bo'yicha, ochiq aytib
    _qamrov = null;
    return tayyor.filter((r) => Date.parse(String(r.analyzed_at).replace(" ", "T") + "Z") >= Date.now() - d * 864e5)
      .map((r) => ({ ...r, at: null, owner: null }));
  }
  const byId = new Map(calls.map((c) => [String(c.ID), c]));
  const R = tayyor.filter((r) => byId.has(String(r.call_id)))
    .map((r) => { const c = byId.get(String(r.call_id)); return { ...r, at: c.CREATED, owner: String(c.RESPONSIBLE_ID || "") }; })
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const javobsiz = calls.filter((c) => c.SETTINGS && c.SETTINGS.MISSED_CALL === true).length;
  _qamrov = { davrda: calls.length, javobsiz, tahlil: R.length };
  return R;
};
// Sarlavha: davr qanday olingani va qamrov — har buyruqda bir xil
const sarlavha = (nom, d) => {
  if (!_qamrov) return `${nom} — ${oyna(d)} (DIQQAT: CRM javob bermadi — tahlil sanasi bo'yicha olindi)`;
  const q = _qamrov;
  return `${nom} — ${oyna(d)}, QO'NG'IROQ vaqti bo'yicha. Davrda ${q.davrda} ta qo'ng'iroq`
    + ` (${q.javobsiz} tasi javobsiz), tahlil qilingani ${q.tahlil} ta`;
};
const bosh = (d) => {                      // davrda qo'ng'iroq yo'q bo'lsa — halol sabab
  if (_qamrov && _qamrov.davrda === 0) {
    const o = oxirgiQongiroq();
    say(`${oyna(d)} — bu davrda SUN-HIGHTECH qo'ng'irog'i qayd etilmagan — o'lchanmadi (0 emas).`
      + (o ? ` Eng oxirgi qo'ng'iroq: ${tkSana(o)}. Undan keyingi qo'ng'iroqlar Odoo'ga tushmagan.` : ""));
    say(`Eski qo'ng'iroqlar tahlilini ko'rish uchun kattaroq davr bering (masalan 120).`);
    fin();
  }
};
const parse = (r) => { try { return JSON.parse(r.json); } catch { return null; } };

if (!cmd || cmd === "help") {
  say("Buyruqlar: kpi | kritik | reyting | mezon | operator <id> | etiroz | qongiroq <id> | tahlilsiz");
  say("Har biriga ixtiyoriy [kun] qo'shiladi, standart 30. DIQQAT: [kun] = N×24 soat, hozirdan orqaga siljiydigan oyna — kalendar kun EMAS.");
  fin();
}

if (cmd === "kpi") {
  const d = days(), R = rows(d);
  say(sarlavha("QO'NG'IROQ TAHLILI", d)); bosh(d);
  if (!R.length) { say("Bu davrdagi qo'ng'iroqlarning birortasi hali tahlil qilinmagan."); fin(); }
  const sc = R.map((r) => r.score).filter(Number.isFinite);
  const avg = Math.round(sc.reduce((a, b) => a + b, 0) / sc.length);
  say(`O'rtacha ball: ${avg}/100 (eng past ${Math.min(...sc)}, eng yuqori ${Math.max(...sc)})`);
  const by = (k, v) => R.filter((r) => r[k] === v).length;
  say(`Xavf: kritik ${by("risk", "critical")}, yuqori ${by("risk", "high")}, o'rta ${by("risk", "medium")}, past ${by("risk", "low")}`);
  say(`Kayfiyat: ijobiy ${by("sentiment", "positive")}, neytral ${by("sentiment", "neutral")}, salbiy ${by("sentiment", "negative")}`);
  const noNext = R.filter((r) => { const j = parse(r); return !j?.next_action?.text && !j?.next_action?.type; }).length;
  say(`Keyingi qadam belgilanmagan: ${noNext} ta`);
  const rev = db.prepare("SELECT COUNT(*) c FROM call_reviews").get().c;
  say(`Rahbar ko'rib chiqqan: ${rev} ta`);
  if (R.length < 5) say("DIQQAT: namuna kichik — o'rtacha ko'rsatkichlar hali ishonchsiz.");
  fin();
}

if (cmd === "kritik") {
  const d = days(), R = rows(d).filter((r) => ["critical", "high"].includes(r.risk));
  say(sarlavha("KRITIK VA YUQORI XAVFLI SUHBATLAR", d)); bosh(d);
  say(`Kritik/yuqori xavfli: ${R.length} ta`);
  if (!R.length) { say("Yo'q."); fin(); }
  for (const r of R.slice(0, 15)) {
    const j = parse(r); if (!j) continue;
    const rv = db.prepare("SELECT actor FROM call_reviews WHERE call_id=?").get(r.call_id);
    say("");
    say(`#${r.call_id} — ${RISK[r.risk]} · ball ${r.score}/100 · ${SENT[r.sentiment] || "?"} · qo'ng'iroq ${r.at ? tkSana(r.at) : "sanasi noma'lum"}`);
    if (r.topic) say(`  mavzu: ${r.topic}`);
    say(`  sabab: ${(j.deal_risk?.reasons || []).join("; ") || "—"}`);
    const m = (j.critical_moments || []).find((x) => x.speaker === "customer" && x.kind === "risk")
           || (j.critical_moments || []).find((x) => x.speaker === "customer");
    if (m) say(`  mijoz (${m.ts}): «${String(m.quote).slice(0, 140)}»`);
    say(`  keyingi qadam: ${j.next_action?.text || "BELGILANMAGAN"}`);
    say(`  rahbar ko'rdi: ${rv ? rv.actor : "YO'Q"}`);
  }
  fin();
}

if (cmd === "reyting" || cmd === "mezon" || cmd === "operator") {
  const d = days(), R = rows(d);
  if (_qamrov && _qamrov.davrda === 0) { say(sarlavha(cmd.toUpperCase(), d)); bosh(d); }
  if (!R.length) { say(`${oyna(d)} — bu davrdagi qo'ng'iroqlarning tahlili yo'q.`); fin(); }
  // Operator ID tahlil JSON'ida yo'q; call_alerts faqat ogohlantirishda yoziladi.
  // Ism CRM'dan (adapter, faqat o'qish) KERAKLI ID lar bo'yicha bir marta olinadi.
  const _oCache = new Map(); let _oYuklandi = false;
  const crmOwnerlar = (kerak = []) => {
    if (_oYuklandi) return _oCache;
    _oYuklandi = true;
    const url = String(process.env.BITRIX_WEBHOOK_URL || "");
    if (!url) return _oCache;
    try {
      for (let i = 0; i < kerak.length; i += 40) {
        const body = JSON.stringify({ filter: { TYPE_ID: 2, ID: kerak.slice(i, i + 40) }, select: ["ID", "RESPONSIBLE_ID"], start: 0 });
        const res = execSync(`curl -s -m 25 ${JSON.stringify(url + "crm.activity.list.json")} -H "Content-Type: application/json" -d ${JSON.stringify(body)}`, { encoding: "utf8", maxBuffer: 8e6 });
        for (const r of (JSON.parse(res).result || [])) _oCache.set(String(r.ID), String(r.RESPONSIBLE_ID || ""));
      }
      const ru = execSync(`curl -s -m 25 ${JSON.stringify(url + "user.get.json")} -H "Content-Type: application/json" -d '{"start":0}'`, { encoding: "utf8", maxBuffer: 8e6 });
      for (const u of (JSON.parse(ru).result || [])) {
        const nom = [u.NAME, u.LAST_NAME].filter(Boolean).join(" ").trim();
        if (nom) _oCache.set("ism:" + String(u.ID), nom);
      }
    } catch {}
    return _oCache;
  };
  // Ism har doim CRM'dan (user.get) — ilgari avval ogohlantirish yozuvidagi ism olinardi va u
  // boshqa tartibda («operator Adham» / «Adham operator») bo'lgani uchun reytingda bitta operator
  // ikki qator bo'lib chiqardi.
  const ownerOf = (id) => {
    const c = crmOwnerlar(R.map((r) => String(r.call_id)));
    const uid = R.find((x) => String(x.call_id) === String(id))?.owner || c.get(String(id));
    if (uid) return c.get("ism:" + uid) || ("#" + uid);
    const a = db.prepare("SELECT payload FROM call_alerts WHERE call_id=?").get(id);
    if (a) { try { const o = JSON.parse(a.payload).owner; if (o) return o; } catch {} }
    return null;
  };
  if (cmd === "mezon") {
    const sum = {}, n = {}, lab = {};
    for (const r of R) for (const c of parse(r)?.operator_score?.criteria || []) {
      sum[c.id] = (sum[c.id] || 0) + c.score / c.max; n[c.id] = (n[c.id] || 0) + 1; lab[c.id] = c.label;
    }
    const list = Object.keys(sum).map((k) => ({ label: lab[k], pct: Math.round(sum[k] / n[k] * 100) }))
      .sort((a, b) => b.pct - a.pct);
    say(`MEZONLAR BO'YICHA JAMOA — ${oyna(d)}, qo'ng'iroq vaqti bo'yicha, ${R.length} tahlil`);
    for (const c of list) say(`  ${String(c.pct).padStart(3)}%  ${c.label}`);
    say("");
    say(`Eng zaif: ${list.slice(-2).map((c) => c.label).join(", ")}`);
    fin();
  }
  const byOwner = new Map();
  for (const r of R) {
    const o = ownerOf(r.call_id) || "noma'lum";
    if (!byOwner.has(o)) byOwner.set(o, { o, n: 0, sum: 0, crit: 0, weak: {} });
    const b = byOwner.get(o);
    b.n++; b.sum += r.score || 0;
    if (r.risk === "critical") b.crit++;
    for (const c of parse(r)?.operator_score?.criteria || [])
      b.weak[c.label] = (b.weak[c.label] || 0) + c.score / c.max;
  }
  if (cmd === "reyting") {
    say(`OPERATORLAR REYTINGI — ${oyna(d)}, qo'ng'iroq vaqti bo'yicha, ${R.length} tahlil`);
    const list = [...byOwner.values()].map((b) => ({ ...b, avg: Math.round(b.sum / b.n) })).sort((a, b) => b.avg - a.avg);
    for (const b of list) say(`  ${b.avg}/100 · ${b.o} · ${b.n} tahlil${b.crit ? ` · ${b.crit} kritik` : ""}`);
    if (list.some((b) => b.n < 5)) say("\nDIQQAT: 5 tadan kam tahlili bor operatorning o'rtachasi ishonchsiz.");
    fin();
  }
  const who = rest.find((x) => !/^\d{1,3}$/.test(x)) || rest[0];
  const b = [...byOwner.values()].find((x) => String(x.o).includes(String(who)));
  if (!b) { say(`"${who}" bo'yicha ${d} kunda tahlil topilmadi. Mavjudlari: ${[...byOwner.keys()].join(", ")}`); fin(); }
  say(`OPERATOR ${b.o} — ${oyna(d)}`);
  say(`O'rtacha ball: ${Math.round(b.sum / b.n)}/100 · ${b.n} tahlil · ${b.crit} kritik`);
  const weak = Object.entries(b.weak).map(([l, v]) => ({ l, pct: Math.round(v / b.n * 100) })).sort((x, y) => x.pct - y.pct);
  say("Mezonlar (pastdan yuqoriga):");
  for (const w of weak) say(`  ${String(w.pct).padStart(3)}%  ${w.l}`);
  fin();
}

if (cmd === "etiroz" || cmd === "muammo") {
  const d = days(), R = rows(d);
  say(sarlavha("E'TIROZ VA MUAMMOLAR", d)); bosh(d);
  const obj = new Map(), prob = new Map(), terms = new Map();
  for (const r of R) {
    const j = parse(r); if (!j) continue;
    for (const o of j.objections || []) if (o.text) obj.set(o.text, (obj.get(o.text) || 0) + 1);
    for (const p of j.problems || []) if (p.title) prob.set(p.title, (prob.get(p.title) || 0) + 1);
    for (const m of j.critical_moments || [])
      if (m.speaker === "customer" && (m.kind === "objection" || m.kind === "risk"))
        terms.set(m.term, (terms.get(m.term) || 0) + 1);
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  say("");
  say("Mijoz aytgan iboralar (aniq sanoq):");
  for (const [t, n] of top(terms)) say(`  ${String(n).padStart(3)} × ${t}`);
  if (obj.size) { say(""); say("AI ajratgan e'tirozlar:"); for (const [t, n] of top(obj)) say(`  ${String(n).padStart(3)} × ${t}`); }
  if (prob.size) { say(""); say("Mijoz muammolari:"); for (const [t, n] of top(prob)) say(`  ${String(n).padStart(3)} × ${t}`); }
  if (!terms.size && !obj.size) say("Ma'lumot yo'q.");
  fin();
}

if (cmd === "qongiroq") {
  const id = rest[0];
  const r = db.prepare("SELECT * FROM call_analyses WHERE call_id=?").get(String(id));
  if (!r) { say(`#${id} uchun tahlil yo'q.`); fin(); }
  if (r.status !== "ready") { say(`#${id} holati: ${r.status}${r.error ? ` — ${r.error}` : ""}`); fin(); }
  const j = parse(r);
  say(`QO'NG'IROQ #${id} — ${r.analyzed_at} · dvigatel: ${r.engine}`);
  say(`Ball ${j.operator_score.total}/100 · xavf ${RISK[j.deal_risk.level]} · kayfiyat ${SENT[j.sentiment.overall]}`);
  if (j.topic) say(`Mavzu: ${j.topic}`);
  if (j.summary) { say(""); say("Xulosa: " + j.summary); }
  say("");
  say("Mezonlar:");
  for (const c of j.operator_score.criteria) say(`  ${c.score}/${c.max}  ${c.label}${c.tip ? ` — tavsiya: ${c.tip}` : ""}`);
  const cm = (j.critical_moments || []).filter((m) => m.speaker === "customer");
  if (cm.length) {
    say(""); say("Mijoz aytgan muhim gaplar:");
    for (const m of cm.slice(0, 8)) say(`  ${m.ts} «${String(m.quote).slice(0, 120)}» — ${m.reason}`);
  }
  say("");
  say(`Keyingi qadam: ${j.next_action?.text || "BELGILANMAGAN"}${j.next_action?.due ? ` (${j.next_action.due})` : ""}`);
  if (j.droppedByGuard?.length) say(`(${j.droppedByGuard.length} ta AI da'vosi transkriptda tasdiqlanmagani uchun tashlangan)`);
  fin();
}

if (cmd === "tahlilsiz") {
  const d = days();
  const n = db.prepare("SELECT COUNT(*) c FROM call_transcripts").get().c;
  const done = db.prepare("SELECT COUNT(*) c FROM call_analyses WHERE status='ready'").get().c;
  const err = db.prepare("SELECT call_id, error FROM call_analyses WHERE status='error'").all();
  say(`Transkript kiritilgan: ${n} ta · tahlil tayyor: ${done} ta`);
  if (err.length) { say(`Xato bilan tugagan: ${err.length} ta`); for (const e of err.slice(0, 5)) say(`  #${e.call_id}: ${e.error}`); }
  say("Audio Odoo telefoniyasidan avtomatik olinadi; konveyer har 10 daqiqada eng yangisidan tahlil qiladi.");
  fin();
}

say(`Noma'lum buyruq: ${cmd}. "help" deb ko'ring.`);
fin();
