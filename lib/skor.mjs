// Lid skoringi v2 — TZ «Sun-HighTech Sales OS» 3-modul (2026-09-24).
//
// Eski model (scoring.mjs) faqat MANBAGA qarardi — Instagram o'rtachadan past bo'lgani uchun deyarli
// hamma lid «Sovuq» chiqardi (24.09 ekranida 23 dan 22 tasi). Yangi model — 0–100 ball, 4 guruh
// (vaznlar TZ bo'yicha, sozlamada o'zgaradi):
//   Manba 25          — manbaning SUN'dagi konversiyasi (o'rtachaga nisbati)
//   Lid ma'lumoti 30  — segment (B2B/B2C…), hudud, obyekt turi (AI: uy/korxona/ferma), hajm (oylik elektr to'lovi yoki quvvat)
//   Suhbat natijasi 35 — byudjet, muddat (1 oy ichida), qaror qiluvchi, KP/uchrashuvga rozilik: AI (qo'ng'iroq suhbati)
//                        va operator Odoo'da to'ldirgan maydonlar (uchrashuv joyi, to'lov qobiliyati, o'rnatish muddati)
//   Faollik 10        — mijoz qo'ng'iroqqa javob bergan, o'zi qayta qo'ng'iroq qilgan, birinchi urinishdayoq javob bergan
// Toifali belgilar (manba, segment, hudud, obyekt, hajm) SUN'ning O'Z ma'lumotida o'lchanadi: shu qiymatdagi lidlar
// o'rtachadan necha barobar ko'p managerga o'tgan (kichik namuna o'rtachaga tortiladi). Ball = maks × min(1, nisbat/2):
// o'rtacha qiymat — yarim ball, 2 barobar va undan yuqori — to'liq ball.
// MA'LUM BO'LMAGAN belgi ballni tushirmaydi: ball ma'lum belgilar bo'yicha 100 ga keltiriladi; suhbat natijasi
// umuman ma'lum bo'lmasa — «to'liq baholanmagan» belgisi (TZ 3.3). AI «sifatsiz» degan lid — 19 dan oshmaydi (Past).
// Ma'lumoti KAM lid o'rtachaga (50) tortiladi: ball = 50 + (xom − 50) × min(1, ma'lum ulush / 70%) — faqat bitta
// belgi bilan «Issiq» bo'lib qolmasin (24.09 sinovi: faqat «manbasiz» belgisi bor «FDSF» lidi 100 ball olgan edi).
// Manba bo'sh bo'lsa — noma'lum (Odoo'da manbasiz yozuvlar ko'pincha to'g'ridan-to'g'ri imkoniyat — 75% «o'tgan»,
// bu signal emas, artefakt). Hech narsa ma'lum bo'lmasa — «Baholanmagan».
import { cached } from "./cache.mjs";
import * as sifat from "./sifat.mjs";
import { leadOwn } from "./roles.mjs";

const DAY = 864e5;
export const STD = {
  vazn: { manba: 25, malumot: 30, suhbat: 35, faollik: 10 },
  chegara: { issiq: 70, iliq: 45, sovuq: 20 },
  issiq: { ogoh: "off", daq: 15, chat: "", bosh: "09:00", oxir: "19:00" },
};
export const GURUH = { manba: "Manba", malumot: "Lid ma'lumoti", suhbat: "Suhbat natijasi", faollik: "Faollik" };
export const SEG = { HOT: "Issiq", WARM: "Iliq", COLD: "Sovuq", PAST: "Past", NOMALUM: "Baholanmagan" };
// Guruh ichidagi belgilar va ulushi (guruh vazni shu ulushlarga bo'linadi)
const BELGI = {
  manba: [["manba", 1]],
  malumot: [["segment", 8], ["hudud", 6], ["obyekt", 8], ["hajm", 8]],
  suhbat: [["byudjet", 9], ["muddat", 9], ["qaror", 8], ["rozi", 9]],
  faollik: [["javob", 4], ["qayta", 4], ["tez", 2]],
};
export const NOM = { manba: "Manba", segment: "Segment", hudud: "Hudud", obyekt: "Obyekt turi", hajm: "Hajm (oylik to'lov / quvvat)",
  byudjet: "Byudjet bor", muddat: "O'rnatish muddati", qaror: "Qaror qiluvchi bilan gaplashildi", rozi: "KP / uchrashuvga rozi",
  javob: "Qo'ng'iroqqa javob bergan", qayta: "O'zi qayta qo'ng'iroq qilgan", tez: "Birinchi urinishda javob bergan" };

// ---- Sozlama (settings.skor) ----
export function sozlama(db) {
  let v = null;
  try { v = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='skor'").get()?.value || "null"); } catch {}
  const num = (x, d, lo, hi) => { const n = Number(x); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
  const vazn = {}; for (const k of Object.keys(STD.vazn)) vazn[k] = num(v?.vazn?.[k], STD.vazn[k], 0, 100);
  const chegara = { issiq: num(v?.chegara?.issiq, 70, 1, 100), iliq: num(v?.chegara?.iliq, 45, 1, 100), sovuq: num(v?.chegara?.sovuq, 20, 0, 100) };
  const i = v?.issiq || {}, HM = /^([01]\d|2[0-3]):[0-5]\d$/;
  const issiq = { ogoh: i.ogoh === "on" ? "on" : "off", daq: num(i.daq, 15, 5, 240), chat: /^-?\d{5,20}$/.test(String(i.chat || "")) ? String(i.chat) : "",
    bosh: HM.test(i.bosh || "") ? i.bosh : "09:00", oxir: HM.test(i.oxir || "") ? i.oxir : "19:00" };
  return { vazn, chegara, issiq };
}
export function setSozlama(db, patch, userId) {
  const was = sozlama(db), cur = JSON.parse(JSON.stringify(was));
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  if (patch.vazn) for (const k of Object.keys(STD.vazn)) if (k in patch.vazn) {
    const n = Number(patch.vazn[k]); if (!(n >= 0 && n <= 100)) throw bad(`${GURUH[k]} vazni 0–100 bo'lsin`); cur.vazn[k] = n;
  }
  if (Object.values(cur.vazn).reduce((a, b) => a + b, 0) <= 0) throw bad("Vaznlar yig'indisi 0 bo'lmasin");
  if (patch.chegara) for (const k of ["issiq", "iliq", "sovuq"]) if (k in patch.chegara) {
    const n = Number(patch.chegara[k]); if (!(n >= 0 && n <= 100)) throw bad("Chegaralar 0–100"); cur.chegara[k] = n;
  }
  if (!(cur.chegara.issiq > cur.chegara.iliq && cur.chegara.iliq > cur.chegara.sovuq)) throw bad("Chegaralar: Issiq > Iliq > Sovuq bo'lsin");
  if (patch.issiq) {
    const i = patch.issiq;
    if ("ogoh" in i) cur.issiq.ogoh = i.ogoh === "on" ? "on" : "off";
    if ("daq" in i) { const n = Number(i.daq); if (!(n >= 5 && n <= 240)) throw bad("Daqiqa 5–240"); cur.issiq.daq = n; }
    if ("chat" in i) { const c = String(i.chat || "").trim(); if (c && !/^-?\d{5,20}$/.test(c)) throw bad("Telegram chat ID — raqam (masalan -100…)"); cur.issiq.chat = c; }
    for (const k of ["bosh", "oxir"]) if (k in i) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(i[k] || ""))) throw bad("Vaqt SS:DD"); cur.issiq[k] = i[k]; }
  }
  db.prepare(`INSERT INTO settings (key,value,updated_by) VALUES ('skor',?,?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=datetime('now')`).run(JSON.stringify(cur), userId);
  return { was, now: sozlama(db) };
}

// ---- Belgilar (lid yozuvi — adapterning L shakli; q — AI lid sifati) ----
const bill = (s) => (s < 300e3 ? "300 mingdan kam" : s < 1e6 ? "300 ming – 1 mln" : s < 3e6 ? "1–3 mln" : "3 mln va ko'p");
const kwt = (k) => (k < 10 ? "10 kVt dan kam" : k < 30 ? "10–30 kVt" : k < 100 ? "30–100 kVt" : "100 kVt va ko'p");
const hududNom = (s) => { const v = String(s || "").trim(); return !v ? null : v.includes("_") ? v.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") : v; };
function toifa(x, q) {
  return {
    manba: x.SOURCE_DESCRIPTION || null,
    segment: x.UF_CRM_CLIENT_TYPE || null,
    hudud: hududNom(x.ADDRESS_CITY),
    obyekt: q?.signals?.object ? { uy: "Uy", korxona: "Korxona / biznes", ferma: "Ferma", boshqa: "Boshqa" }[q.signals.object] || null : null,
    hajm: Number(x.UF_CRM_BILL) > 0 ? `To'lov: ${bill(Number(x.UF_CRM_BILL))}` : Number(x.UF_CRM_KWT) > 0 ? `Quvvat: ${kwt(Number(x.UF_CRM_KWT))}` : null,
  };
}
// Suhbat natijasi: 1 — to'liq, 0 — yo'q, oraliq — qisman; null — noma'lum. Manba: AI yoki Odoo maydoni.
function suhbat(x, q) {
  const s = q?.signals || {}, out = {};
  const muddatK = (t) => { const v = String(t || "").toLowerCase(); if (!v) return null;
    if (/хафта|hafta|kun|кун|1[-\s]?ой|1[-\s]?oy|bir oy|oy ichida|шу ой|darhol|tez/.test(v)) return 1;
    if (/[23][-\s]?(ой|oy)|3[-\s]?ой/.test(v)) return 0.5; if (/6|йил|yil|kuz|bahor|keyin/.test(v)) return 0.2; return 0.5; };
  // Byudjet
  if (s.budget === true) out.byudjet = [1, "AI: byudjet bor" + (s.budgetMatn ? ` («${s.budgetMatn}»)` : "")];
  else if (x.UF_CRM_TOLOV) out.byudjet = [/oldin/i.test(x.UF_CRM_TOLOV) ? 1 : 0.6, `Odoo: to'lov qobiliyati «${x.UF_CRM_TOLOV}»`];
  else if (s.budget === false) out.byudjet = [0, "AI: byudjet yo'q"];
  // Muddat
  const mO = muddatK(x.UF_CRM_MUDDAT), mA = muddatK(s.timeline);
  if (mA !== null) out.muddat = [mA, `AI: muddat «${s.timeline}»`];
  else if (mO !== null) out.muddat = [mO, `Odoo: o'rnatish muddati «${x.UF_CRM_MUDDAT}»`];
  // Qaror qiluvchi
  if (s.decisionMaker === true) out.qaror = [1, "AI: qaror qiluvchi bilan gaplashildi"];
  else if (s.decisionMaker === false) out.qaror = [0, "AI: qaror qiluvchi emas"];
  // KP / uchrashuvga rozilik
  if (s.agreed === "kp" || s.agreed === "uchrashuv" || s.agreed === "obyekt_korigi") out.rozi = [1, `AI: ${{ kp: "KP ga", uchrashuv: "uchrashuvga", obyekt_korigi: "obyekt ko'rigiga" }[s.agreed]} rozi`];
  else if (x.UF_CRM_UCHR_JOY) out.rozi = [1, `Odoo: uchrashuv joyi «${x.UF_CRM_UCHR_JOY}»`];
  else if (x.UF_CRM_PIPE === "Кп" || x.UF_CRM_KP === "Y") out.rozi = [1, "Odoo: KP bosqichi"];
  else if (s.agreed === "qayta_qongiroq") out.rozi = [0.4, "AI: qayta qo'ng'iroqqa kelishildi"];
  else if (s.agreed === "yoq") out.rozi = [0, "AI: keyingi qadam kelishilmadi"];
  return out;
}
function faollik(x) {
  const out = {}, n = Number(x.UF_CRM_CALLS_N || 0);
  if (!n) return out;                                           // hali qo'ng'iroq qilinmagan — noma'lum
  const ans = Number(x.UF_CRM_CALLS_ANS || 0), kir = Number(x.UF_CRM_CALLS_IN || 0);
  out.javob = [ans > 0 ? 1 : 0, ans > 0 ? `${ans} ta qo'ng'iroqqa javob berilgan` : `${n} ta qo'ng'iroq — javob yo'q`];
  out.qayta = [kir > 0 ? 1 : 0, kir > 0 ? `mijoz ${kir} marta o'zi qo'ng'iroq qilgan` : "mijoz o'zi qo'ng'iroq qilmagan"];
  if (x.UF_CRM_TRY1) out.tez = [x.UF_CRM_TRY1 === "Y" ? 1 : 0, x.UF_CRM_TRY1 === "Y" ? "birinchi urinishdayoq javob bergan" : "birinchi urinishda javob bermagan"];
  return out;
}

// ---- Kalibrlash: toifali belgilarning SUN'dagi nisbati (managerga o'tish) ----
const K_SHRINK = 20;
function olch(items, Q) {
  const conv = items.filter((x) => x.STATUS_SEMANTIC_ID === "S").length, base = items.length ? conv / items.length : 0;
  const tab = {};
  for (const f of ["manba", "segment", "hudud", "obyekt", "hajm"]) tab[f] = new Map();
  for (const x of items) {
    const t = toifa(x, Q.get(String(x.ID))), s = x.STATUS_SEMANTIC_ID === "S" ? 1 : 0;
    for (const [f, v] of Object.entries(t)) { if (v === null) continue; const o = tab[f].get(v) || { n: 0, c: 0 }; o.n++; o.c += s; tab[f].set(v, o); }
  }
  const lift = {};
  for (const [f, m] of Object.entries(tab)) {
    lift[f] = {};
    for (const [v, o] of m) lift[f][v] = { n: o.n, c: o.c, foiz: Math.round((o.c / o.n) * 1000) / 10,
      lift: base ? Math.round((((o.c + K_SHRINK * base) / (o.n + K_SHRINK)) / base) * 100) / 100 : 1 };
  }
  return { n: items.length, conv, base: Math.round(base * 1000) / 10, lift };
}

// ---- Ball ----
export function baho(x, K, cfg, q = null) {
  const t = toifa(x, q), S = suhbat(x, q), F = faollik(x);
  const tarkib = [];
  let earned = 0, possible = 0;
  for (const [g, list] of Object.entries(BELGI)) {
    const gw = cfg.vazn[g] || 0, sum = list.reduce((a, [, w]) => a + w, 0);
    for (const [f, w] of list) {
      const max = gw * (w / sum);
      let k = null, izoh = "";
      if (g === "manba" || g === "malumot") {
        const v = t[f]; if (v === null) continue;
        const L = K?.lift?.[f]?.[v];
        const lf = L ? L.lift : 1;
        k = Math.max(0, Math.min(1, lf / 2));
        izoh = `${v}: ${L ? `SUN'da ${L.foiz}% managerga o'tgan (${L.n} lid), o'rtachaning ${lf}×` : "o'lchanmagan — o'rtacha olingan"}`;
      } else if (g === "suhbat") { if (!S[f]) continue; [k, izoh] = S[f]; }
      else { if (!F[f]) continue; [k, izoh] = F[f]; }
      earned += k * max; possible += max;
      tarkib.push({ guruh: g, belgi: f, nom: NOM[f], ball: Math.round(k * max * 10) / 10, max: Math.round(max * 10) / 10, izoh });
    }
  }
  const jamiVazn = Object.values(cfg.vazn).reduce((a, b) => a + b, 0) || 1;
  const malumUlush = Math.round((possible / jamiVazn) * 100);
  const sifatsiz = q?.verdict === "sifatsiz";
  let ball = null, seg = "NOMALUM";
  if (possible > 0) {
    const xom = (earned / possible) * 100;
    ball = Math.round(50 + (xom - 50) * Math.min(1, malumUlush / 70));
    if (sifatsiz) ball = Math.min(ball, Math.max(0, cfg.chegara.sovuq - 1));
    seg = ball >= cfg.chegara.issiq ? "HOT" : ball >= cfg.chegara.iliq ? "WARM" : ball >= cfg.chegara.sovuq ? "COLD" : "PAST";
  }
  const toliq = tarkib.some((r) => r.guruh === "suhbat");
  const guruhlar = Object.keys(BELGI).map((g) => {
    const r = tarkib.filter((x) => x.guruh === g);
    return { g, nom: GURUH[g], vazn: cfg.vazn[g], ball: Math.round(r.reduce((a, x) => a + x.ball, 0) * 10) / 10, max: Math.round(r.reduce((a, x) => a + x.max, 0) * 10) / 10, malum: r.length > 0 };
  });
  return { ball, seg, segNom: SEG[seg], toliq, sifatsiz, ai: q ? q.verdict : null, malumUlush, guruhlar, tarkib };
}

// ---- Ma'lumot olish ----
const SEL = ["ID", "TITLE", "NAME", "LAST_NAME", "COMPANY_TITLE", "DATE_CREATE", "STATUS_ID", "STATUS_SEMANTIC_ID", "STATUS_DESCRIPTION",
  "SOURCE_DESCRIPTION", "ADDRESS_CITY", "UF_CRM_CLIENT_TYPE", "UF_CRM_OPERATOR", "UF_CRM_OPERATOR_NAME", "UF_CRM_TYPE", "UF_CRM_PIPE", "UF_CRM_KP",
  "UF_CRM_BILL", "UF_CRM_KWT", "UF_CRM_UCHR_JOY", "UF_CRM_TOLOV", "UF_CRM_MUDDAT", "UF_CRM_CALLS_N", "UF_CRM_CALLS_ANS", "UF_CRM_CALLS_IN",
  "UF_CRM_TRY1", "UF_CRM_FIRST_CONTACT", "UF_CRM_ODOO_URL", "UF_CRM_MANAGER", "UF_CRM_DEAL_STAGE", "PHONE"];
const tkDate = (ms) => new Date(ms + 5 * 3600e3).toISOString().slice(0, 10);
async function lidlar(bx, fromMs, toMs, owner = null) {
  const { items } = await bx.listAll("crm.lead.list", {
    filter: { ">=DATE_CREATE": `${tkDate(fromMs)}T00:00:00+05:00`, "<=DATE_CREATE": `${tkDate(toMs)}T23:59:59+05:00`, ...leadOwn(owner) },
    select: SEL, order: { DATE_CREATE: "ASC" }, maxItems: 20000,
  });
  return items;
}

// Kalibrlash (ishlaydigan model): natijasi ma'lum lidlar — 30–365 kun oldin yaratilgan. 6 soat kesh.
export const kalib = (bx, db) => cached("skor:kalib", 6 * 3600e3, async () => {
  const now = Date.now();
  const items = await lidlar(bx, now - 365 * DAY, now - 30 * DAY);
  const Q = sifat.ofLeads(db, items.map((x) => x.ID));
  return { ...olch(items, Q), oyna: { dan: tkDate(now - 365 * DAY), gacha: tkDate(now - 30 * DAY) }, at: new Date().toISOString() };
});

// TZ 3.3 tekshiruvi (vaqt bo'yicha): 120–365 kun oldingi lidlarda o'lchab, 30–120 kun oldingilarda sinash.
// Mezoni: «Issiq» segment konversiyasi «Sovuq»dan kamida 3 barobar yuqori. Natija har oy jadvalda saqlanadi.
export function initSkor(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS skor_tekshiruv (oy TEXT PRIMARY KEY, at TEXT NOT NULL, json TEXT NOT NULL);
           CREATE TABLE IF NOT EXISTS skor_ogoh (lead_id TEXT PRIMARY KEY, at TEXT NOT NULL, ball INTEGER, chat TEXT, msg INTEGER);`);
}
export const tekshiruv = (bx, db) => cached("skor:tekshiruv", 6 * 3600e3, async () => {
  const now = Date.now(), cfg = sozlama(db);
  const eski = await lidlar(bx, now - 365 * DAY, now - 120 * DAY);
  const yangi = await lidlar(bx, now - 120 * DAY, now - 30 * DAY);
  const Q = sifat.ofLeads(db, [...eski, ...yangi].map((x) => x.ID));
  const K = olch(eski, Q);
  const seg = {}; for (const k of Object.keys(SEG)) seg[k] = { n: 0, c: 0, toliqEmas: 0 };
  for (const x of yangi) {
    const b = baho(x, K, cfg, Q.get(String(x.ID)));
    seg[b.seg].n++; if (x.STATUS_SEMANTIC_ID === "S") seg[b.seg].c++; if (!b.toliq) seg[b.seg].toliqEmas++;
  }
  const rows = Object.entries(seg).map(([k, o]) => ({ seg: k, nom: SEG[k], n: o.n, c: o.c, foiz: o.n ? Math.round((o.c / o.n) * 1000) / 10 : null, toliqEmas: o.toliqEmas }));
  const f = (k) => rows.find((r) => r.seg === k)?.foiz;
  const hot = f("HOT"), cold = f("COLD");
  // Sovuqda konversiya 0% bo'lsa nisbat cheksiz — Issiq 0 dan katta bo'lsa mezon bajarilgan
  const cheksiz = hot > 0 && cold === 0;
  const nisbat = hot !== null && hot !== undefined && cold ? Math.round((hot / cold) * 10) / 10 : null;
  const out = { oquv: { dan: tkDate(now - 365 * DAY), gacha: tkDate(now - 120 * DAY), n: K.n, base: K.base },
    sinov: { dan: tkDate(now - 120 * DAY), gacha: tkDate(now - 30 * DAY), n: yangi.length }, rows, nisbat, cheksiz,
    otdi: cheksiz ? true : nisbat !== null ? nisbat >= 3 : null, mezon: "Issiq konversiyasi Sovuqdan kamida 3 barobar yuqori", at: new Date().toISOString() };
  try {
    const oy = new Date(now + 5 * 3600e3).toISOString().slice(0, 7);
    db.prepare("INSERT OR REPLACE INTO skor_tekshiruv (oy, at, json) VALUES (?,?,?)").run(oy, out.at, JSON.stringify(out));   // oyning oxirgi hisobi
  } catch {}
  return out;
});
export function tarix(db) {
  try { return db.prepare("SELECT oy, at, json FROM skor_tekshiruv ORDER BY oy DESC LIMIT 12").all().map((r) => { const j = JSON.parse(r.json); return { oy: r.oy, at: r.at, nisbat: j.nisbat, cheksiz: !!j.cheksiz, otdi: j.otdi, rows: j.rows }; }); }
  catch { return []; }
}

// Davrdagi lidlar bo'yicha skoring: segmentlar, ochiq lidlar navbati (eng yuqori ball birinchi)
const lidNomi = (x) => x.COMPANY_TITLE || [x.NAME, x.LAST_NAME].filter(Boolean).join(" ") || x.TITLE || `Lid #${x.ID}`;
export const sharh = (bx, db, { R, owner = null, limit = 300 } = {}) =>
  cached(`skor:sharh:${R.key}:${owner || "all"}:${JSON.stringify(sozlama(db))}`, 60e3, () => sharhHisob(bx, db, { R, owner, limit }));
async function sharhHisob(bx, db, { R, owner = null, limit = 300 } = {}) {
  const cfg = sozlama(db), K = await kalib(bx, db);
  const items = await lidlar(bx, Date.parse(R.fromISO), Date.parse(R.toISO), owner);
  const Q = sifat.ofLeads(db, items.map((x) => x.ID));
  const seg = {}; for (const k of Object.keys(SEG)) seg[k] = { n: 0, ochiq: 0 };
  let toliqEmas = 0;
  const ochiq = [];
  for (const x of items) {
    const b = baho(x, K, cfg, Q.get(String(x.ID)));
    seg[b.seg].n++; if (!b.toliq) toliqEmas++;
    const isOpen = x.STATUS_SEMANTIC_ID === "P";
    if (isOpen) {
      seg[b.seg].ochiq++;
      ochiq.push({ id: x.ID, nom: lidNomi(x), ball: b.ball, seg: b.seg, segNom: b.segNom, toliq: b.toliq, ai: b.ai, malumUlush: b.malumUlush,
        operator: x.UF_CRM_OPERATOR_NAME || "", holat: x.STATUS_DESCRIPTION || "", yaratilgan: x.DATE_CREATE, qongiroq: Number(x.UF_CRM_CALLS_N || 0),
        guruhlar: b.guruhlar, tarkib: b.tarkib, url: x.UF_CRM_ODOO_URL || null });
    }
  }
  ochiq.sort((a, b) => (b.ball ?? -1) - (a.ball ?? -1) || String(b.yaratilgan).localeCompare(String(a.yaratilgan)));
  return { jami: items.length, toliqEmas, seg: Object.entries(seg).map(([k, o]) => ({ seg: k, nom: SEG[k], ...o })),
    ochiq: ochiq.slice(0, limit), ochiqJami: ochiq.length, sozlama: cfg, kalib: { n: K.n, base: K.base, oyna: K.oyna, at: K.at } };
}
export async function kalibJadval(bx, db) {
  const K = await kalib(bx, db);
  const out = {};
  for (const [f, m] of Object.entries(K.lift)) out[f] = Object.entries(m).map(([v, o]) => ({ v, ...o })).sort((a, b) => b.n - a.n).slice(0, 25);
  return { n: K.n, base: K.base, oyna: K.oyna, at: K.at, belgilar: out, nom: NOM };
}
export async function lidBaho(bx, db, x) {
  const cfg = sozlama(db), K = await kalib(bx, db);
  const q = sifat.ofLeads(db, [x.ID]).get(String(x.ID)) || null;
  return baho(x, K, cfg, q);
}

// ---- Issiq lid ogohlantirishi (TZ 3.4): yangi «Issiq» lidga N daqiqada chiquvchi qo'ng'iroq qilinmasa ----
// Har 3 daqiqada: adapter `sun.yangi` (Odoo'dan jonli, snapshotni kutmasdan) → ball → xabar (har lidga BIR marta,
// faqat ish vaqtida; tunda tushgan lid uchun hisob ish boshidan). Sozlama o'chiq bo'lsa hech narsa qilmaydi.
const escH = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
let ogohBand = false;
export function ogohRejalashtir(db, bx, log, auditYoz, tg) {
  const tick = async () => {
    if (ogohBand) return;
    const cfg = sozlama(db); if (cfg.issiq.ogoh !== "on") return;
    const tk = new Date(Date.now() + 5 * 3600e3).toISOString(), hm = tk.slice(11, 16), kun = tk.slice(0, 10);
    if (hm < cfg.issiq.bosh || hm >= cfg.issiq.oxir) return;
    ogohBand = true;
    try {
      const ishBosh = Date.parse(`${kun}T${cfg.issiq.bosh}:00+05:00`);
      const r = await bx.call("sun.yangi", { daq: Math.min(360, Math.ceil((Date.now() - ishBosh) / 60e3) + 180) });
      const leads = r.result?.leads || [];
      if (!leads.length) return;
      const K = await kalib(bx, db), Q = sifat.ofLeads(db, leads.map((x) => x.ID));
      let n = 0;
      for (const x of leads) {
        if (n >= 5) break;                                                      // bir siklda ko'pi bilan 5 ta xabar
        if (x.UF_CRM_TYPE === "opportunity" || x.ACTIVE === "N" || x.UF_CRM_LOST === "Y" || x.UF_CRM_FIRST_OUT) continue;
        if (x.UF_CRM_STAGE_AT && x.UF_CRM_STAGE_AT !== x.DATE_CREATE) continue;   // holati o'zgargan — ishlangan
        const bosh = Math.max(Date.parse(x.DATE_CREATE), ishBosh);
        if (Date.now() - bosh < cfg.issiq.daq * 60e3) continue;
        if (db.prepare("SELECT 1 FROM skor_ogoh WHERE lead_id = ?").get(String(x.ID))) continue;
        const b = baho(x, K, cfg, Q.get(String(x.ID)) || null);
        if (b.seg !== "HOT") continue;
        const kech = Math.round((Date.now() - Date.parse(x.DATE_CREATE)) / 60e3);
        const nom = x.COMPANY_TITLE || x.NAME || x.TITLE || `Lid #${x.ID}`;
        const text = `🔥 <b>Issiq lid — ${kech} daqiqadan beri qo'ng'iroq qilinmagan</b>\n#${x.ID} ${escH(nom)} · ball <b>${b.ball}</b>\n` +
          `Operator: ${escH(x.UF_CRM_OPERATOR_NAME || "tanlanmagan")} · manba: ${escH(x.SOURCE_DESCRIPTION || "—")}` +
          (x.UF_CRM_ODOO_URL ? `\n<a href="${escH(x.UF_CRM_ODOO_URL)}">Odoo'da ochish</a>` : "");
        const s = await tg(text, cfg.issiq.chat || null);
        db.prepare("INSERT OR IGNORE INTO skor_ogoh (lead_id, at, ball, chat, msg) VALUES (?,?,?,?,?)").run(String(x.ID), new Date().toISOString(), b.ball, s.chat, s.msg || null);
        n++; log(`issiq lid #${x.ID} (ball ${b.ball}) — xabar yuborildi`); auditYoz("skor.issiq", `lead:${x.ID}`, `ball ${b.ball}, ${kech} daq`);
      }
    } catch (e) { log(`issiq lid tekshiruvi XATO: ${String(e.message || e).slice(0, 160)}`); }
    finally { ogohBand = false; }
  };
  const t = setInterval(() => { tick().catch(() => {}); }, 3 * 60e3); t.unref?.();
}
