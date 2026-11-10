// Kunlik hisobot — TZ «Sun-HighTech Sales OS» 1-modul: operatorlar kunlik ko'rsatkichlari (2026-09-24).
//
// Operator hech narsani qo'lda kiritmaydi. Manba — faqat Odoo: plitkalar (sun-dashboard.json dagi
// Odoo formulasi, adapter `sun.daily`), Odoo VoIP qo'ng'iroqlari va lid sifati (AI, lib/sifat.mjs).
// Ta'riflar — har birini Odoo'da tekshirsa bo'ladi:
//   Yangi lidlar  — «Tushgan Lead» (#1006): shu kuni yaratilgan
//   Eski lidlar   — shu kuni qo'ng'iroq qilingan yoki holati o'zgargan, oldinroq yaratilgan lidlar
//   Ishlangan     — shu kuni operator HARAKATI bo'lgan lidlar: qo'ng'iroq qilingan, holati o'zgargan, managerga
//                   o'tkazilgan yoki call-markaz xodimi o'zi kiritgan (yangi va eski). Odoo «Ishlangan Leadlar» (#1007)
//                   olinmadi: (1) OdooBot yaratgandayoq «Жараёнда» qo'ygan lidni ham sanaydi (20-sentabr, yakshanba:
//                   qo'ng'iroq 0, #1007 = 61); (2) kunlik konversiya 100% dan oshardi (23-sentabr Oygul: 4 ÷ 2 = 200%).
//                   Odoo #1007 qiymati izohda solishtirish uchun ko'rsatiladi.
//   Ko'tarmadi    — shu kuni qo'ng'iroq qilingan, birortasiga ham javob bo'lmagan lid/raqam
//   Uzatildi      — «Managerga O'tgan Leadlar» (#863): shu kuni managerga o'tkazilgan
//   Uzatish %     — Uzatildi ÷ Yangi lid × 100%, OXIRGI 7 KUN (v2, 2026-10-03 — Boshqaruv markazi bilan bitta ta'rif).
//                   Bir kunlik nisbat sakraydi: 2-oktabr 33 yangi lid, 13 uzatildi (eski lidlar) = 39% — haqiqiy daraja ~10%.
//                   3 tadan kam lid yoki 100% dan oshsa — ko'rsatilmaydi. Reyting — uzatgani soni bo'yicha.
//   Ball          — AI: shu kuni tahlil qilingan qo'ng'iroqlar o'rtachasi (100 dan). Manba — server (olchov.kunBall).
//   Sifatli / Sifatsiz — AI: shu kuni ishlangan lidlarning qo'ng'iroq suhbati bo'yicha (egasi: «AI o'zi aniqlasin»)
//   KP            — shu kuni tushgan lidlardan holati «Кп» bo'lganlari
//   Uchrashuv     — AI: mijoz uchrashuv yoki obyekt ko'rigiga rozi bo'lgan lidlar (Odoo'da uchrashuv maydonlari to'ldirilmaydi)
//   Muddatli      — Odoo «Тўлов қобилияти = Muddatli Tulov» yoki AI: mijoz bo'lib to'lashni so'ragan
//   Belgilanmagan — shu kuni tushgan, hali «Янги лид» holatida turgan lidlar
// Rasm (PNG) — tools/kunlik-png.py (Pillow, serverda brauzer yo'q). Telegram — Sarvar boti,
// «Sotuv bolimi» guruhi (call-alerts bilan bir xil manba: .claude-sotuv/channels/telegram/.env).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Bitrix } from "./bitrix.mjs";
import * as sifat from "./sifat.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.AI_AGENT_HOME || "/home/claude";
const BOT_ENV = process.env.KUNLIK_BOT_ENV || `${BASE}/.claude-sotuv/channels/telegram/.env`;
const PANEL = String(process.env.PANEL_URL || "https://sotuv.81-85-51-135.sslip.io").replace(/\/+$/, "");

let bx = null;
const client = () => {
  const url = String(process.env.BITRIX_WEBHOOK_URL || "");
  if (!/:8098\//.test(url)) return null;                  // faqat Odoo adapteri `sun.daily` ni biladi
  if (!bx) bx = new Bitrix(url, { timeoutMs: 180000 });   // birinchi marta oyna yuklanadi (~20–40 s)
  return bx;
};
const bad = (m, status = 400) => Object.assign(new Error(m), { status });

// ---- Toshkent sanasi ----
const tk = (ms = Date.now()) => new Date(ms + 5 * 3600e3).toISOString();
export const bugun = () => tk().slice(0, 10);
export const kunQosh = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const HAFTA = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];
const OY = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
export const kunNomi = (d) => { const t = new Date(d + "T00:00:00Z"); return `${t.getUTCDate()}-${OY[t.getUTCMonth()]} ${t.getUTCFullYear()}, ${HAFTA[t.getUTCDay()]}`; };
export const qisqaKun = (d) => { const t = new Date(d + "T00:00:00Z"); return `${t.getUTCDate()}-${OY[t.getUTCMonth()].slice(0, 3)}`; };

// ---- Sozlamalar (settings jadvali, kalit `kunlik_*`) ----
//   norma — kunlik qo'ng'iroq normasi (bo'sh = belgi qo'yilmaydi; sotuv rahbari o'zi kiritadi)
//   sariq / qizil — birinchi faollik chegaralari; vaqt — guruhga yuborish vaqti; auto — on/off
//   boshlanish — avtoyuborish shu sanadan (yoqilgan kuni vaqt o'tgan bo'lsa ertadan); oxirgi — oxirgi yuborilgan hisobot kuni
export const STD = { norma: "", sariq: "09:00", qizil: "10:00", vaqt: "19:00", auto: "off", boshlanish: "", oxirgi: "" };
export function sozlama(db) {
  const out = { ...STD };
  for (const r of db.prepare("SELECT key, value FROM settings WHERE key LIKE 'kunlik_%'").all()) {
    const k = r.key.slice(7); if (k in out) out[k] = String(r.value ?? "");
  }
  return out;
}
function setKey(db, k, v, userId = null) {
  db.prepare(`INSERT INTO settings (key,value,updated_by) VALUES (?,?,?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=datetime('now')`)
    .run("kunlik_" + k, String(v ?? ""), userId);
}
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function setSozlama(db, patch, userId) {
  const was = sozlama(db), next = { ...was };
  if ("norma" in patch) {
    const n = String(patch.norma ?? "").trim();
    if (n && !/^\d{1,4}$/.test(n)) throw bad("Norma — butun son (bir kunda qo'ng'iroq) yoki bo'sh");
    next.norma = n === "0" ? "" : n;
  }
  for (const k of ["sariq", "qizil", "vaqt"]) if (k in patch) {
    const v = String(patch[k] || "").trim(); if (!HM.test(v)) throw bad(`${k}: SS:DD ko'rinishida (masalan 09:00)`); next[k] = v;
  }
  if (next.sariq > next.qizil) throw bad("Sariq chegara qizil chegaradan oldin bo'lsin");
  if ("auto" in patch) {
    next.auto = patch.auto === "on" || patch.auto === true ? "on" : "off";
    // Yoqilgan kuni belgilangan vaqt o'tib ketgan bo'lsa — ertadan boshlanadi (kutilmagan kechki xabar bo'lmasin)
    if (next.auto === "on" && (was.auto !== "on" || "vaqt" in patch)) next.boshlanish = tk().slice(11, 16) >= next.vaqt ? kunQosh(bugun(), 1) : bugun();
  }
  for (const k of ["norma", "sariq", "qizil", "vaqt", "auto", "boshlanish"]) if (next[k] !== was[k]) setKey(db, k, next[k], userId);
  return { was, now: sozlama(db) };
}
export function oxirgiXabar(db) {
  try { return JSON.parse(db.prepare("SELECT value FROM settings WHERE key='kunlik_xabar'").get()?.value || "null"); } catch { return null; }
}

// ---- Hisob ----
const BOSH = { yangiIds: [], ishYangiIds: [], qongiroqLid: [], eskiIds: [], kpIds: [], muddatliIds: [], belgilanmaganIds: [], kotarmadiLid: [],
  eski: 0, kotarmadi: 0, boglandi: 0, kp: 0, muddatli: 0, kval: 0, belgilanmagan: 0,
  q: { jami: 0, chiq: 0, kir: 0, javobli: 0, javobsiz: 0, kirJavobsiz: 0, sek: 0, ortacha: 0 }, birinchi: null, oxirgi: null };
// Operator QILGAN qo'ng'iroqlar: chiquvchi + javob bergan kiruvchi. Javobsiz kiruvchi (bir vaqtda 2–3 operatorga
// jiringlaydi, har biriga yozuv tushadi) operator ishi emas — normaga ham, ko'rsatkichga ham qo'shilmaydi.
const qildi = (q) => Math.max(0, (q?.jami || 0) - (q?.kirJavobsiz || 0));
const MIN_ISH = 3;   // reytingga kirish uchun kamida shuncha ishlangan lid (1 dan 1 = 100% bo'lib ketmasin)
const konvOf = (u, i) => (i ? Math.round((u / i) * 1000) / 10 : null);
// v2: uzatish % — uzatildi ÷ yangi lid; 3 tadan kam lid yoki 100% dan oshsa (oldingi kunlar lidi uzatilgan) — null
const uzatishOf = (u, y) => (y >= MIN_ISH && u <= y ? konvOf(u, y) : null);
// 7 kunlik oyna (d dan orqaga 7 kun, d kiradi): { u: uzatildi, y: yangi lid, pct }
const uzatish7 = (v, d, op) => { let u = 0, y = 0; for (let i = 0; i < 7; i++) { const x = kunQosh(d, -i); u += plit(v, x, "863", op); y += plit(v, x, "1006", op); } return { u, y, pct: uzatishOf(u, y) }; };
// v2: AI ball manbai — server ro'yxatdan o'tkazadi (olchov.kunBall): (sana) => { ops: { [operatorId]: { s, n } } }.
// kunlik.mjs qo'ng'iroq moduliga bog'lanmaydi; manba bo'lmasa yoki javob bermasa hisobot ballsiz chiqadi.
let BALL = null;
export const ballManba = (fn) => { BALL = typeof fn === "function" ? fn : null; };
const plit = (v, d, id, op) => { const p = v.kunlar?.[d]?.plit?.[id]; return p ? (op ? p.ops?.[op] || 0 : p.jami || 0) : 0; };

// Faol kun: lid tushgan yoki qo'ng'iroq bo'lgan
const faolKun = (v, d) => { const k = v.kunlar?.[d]; return !!k && ((k.plit?.["1006"]?.jami || 0) > 0 || Object.values(k.ops || {}).some((o) => (o.q?.jami || 0) > 0)); };

// Kutilgan operatorlar: call-markaz guruhining faol a'zolari, oxirgi 14 kunning kamida 3 kunida qo'ng'iroq
// qilganlar. Guruhda turgan, lekin qo'ng'iroq qilmaydigan xodim (masalan menejer) har kuni «faollik yo'q» bo'lmasin.
function kutilgan(v, d) {
  const faol = new Set((v.callMarkazFaol || []).map(String)), kun = new Map(), out = new Set();
  for (let i = 1; i <= 14; i++) {
    const k = v.kunlar?.[kunQosh(d, -i)]; if (!k) continue;
    for (const [u, o] of Object.entries(k.ops || {})) if (faol.has(u) && (o.q?.jami || 0) > 0) kun.set(u, (kun.get(u) || 0) + 1);
  }
  for (const [u, n] of kun) if (n >= 3) out.add(u);
  return out;
}
// Shu kuni ishlangan lidlar (operator bo'yicha): harakat bo'lgan yangi lidlar + qo'ng'iroq qilinganlar + eski lidlar
const ishIdsOf = (o) => [...new Set([...(o?.ishYangiIds || []), ...(o?.qongiroqLid || []), ...(o?.eskiIds || [])].map(String))];
// Jadvalga kiradiganlar: call-markaz a'zolari va plitkalarda «Оператор» bo'lib turganlar
function operatorlar(v, d) {
  const k = v.kunlar?.[d] || {}, set = new Set((v.callMarkaz || []).map(String));
  for (const id of ["1006", "1007", "863"]) for (const u of Object.keys(k.plit?.[id]?.ops || {})) if (u) set.add(u);
  return set;
}

function qatorlar(v, d, S, Q, op) {
  const k = v.kunlar?.[d] || { plit: {}, ops: {} };
  const t = (id, u) => k.plit?.[id]?.ops?.[u] || 0;
  const cm = new Set((v.callMarkaz || []).map(String));
  const ids = new Set([...Object.keys(k.ops || {}), ...["1006", "1007", "863", "791"].flatMap((id) => Object.keys(k.plit?.[id]?.ops || {}))]);
  if (faolKun(v, d)) for (const u of kutilgan(v, d)) ids.add(u);   // kelmagan operator ham qatorda ko'rinsin
  const norma = Number(S.norma) || 0;
  const out = [];
  for (const u of ids) {
    if (!u || (op && u !== op)) continue;
    const o = { ...BOSH, ...(k.ops?.[u] || {}) };
    const yangi = t("1006", u), uzatildi = t("863", u), otkaz = t("791", u);
    const ishIds = ishIdsOf(o), ishlangan = ishIds.length;
    if (!cm.has(u) && !yangi && !t("1007", u) && !uzatildi) continue;   // call-markazdan tashqari va lidi yo'q (menejer qo'ng'iroqlari)
    const ish = ishIds;
    const s = { sifatli: [], sifatsiz: [], noaniq: [], baholanmagan: [] };
    const uchr = [], mudd = new Set(o.muddatliIds.map(String));
    for (const id of ish) {
      const x = Q.get(id);
      if (!x) { s.baholanmagan.push(id); continue; }
      (s[x.verdict] || s.noaniq).push(id);
      if (x.signals?.agreed === "uchrashuv" || x.signals?.agreed === "obyekt_korigi") uchr.push(id);
      if (x.signals?.installment === true) mudd.add(id);
    }
    const bayroq = [];
    if (!o.birinchi && cm.has(u)) bayroq.push({ k: "faollik", rang: "qizil", t: "Kun davomida faollik qayd etilmagan" });
    else if (o.birinchi && S.qizil && o.birinchi > S.qizil) bayroq.push({ k: "faollik", rang: "qizil", t: `Birinchi faollik ${o.birinchi} — ${S.qizil} dan kech` });
    else if (o.birinchi && S.sariq && o.birinchi > S.sariq) bayroq.push({ k: "faollik", rang: "sariq", t: `Birinchi faollik ${o.birinchi} — ${S.sariq} dan kech` });
    const q = { ...o.q, qildi: qildi(o.q) };
    if (norma && cm.has(u) && q.qildi < norma) bayroq.push({ k: "qongiroq", rang: "sariq", t: `Qo'ng'iroq ${q.qildi} ta — kunlik norma ${norma}` });
    out.push({ id: u, ism: v.ismlar?.[u] || `#${u}`, callMarkaz: cm.has(u),
      birinchi: o.birinchi, oxirgi: o.oxirgi, yangi, eski: o.eski, ishlangan, kotarmadi: o.kotarmadi, boglandi: o.boglandi,
      sifatli: s.sifatli.length, sifatsiz: s.sifatsiz.length, noaniq: s.noaniq.length, baholanmagan: s.baholanmagan.length, kval: o.kval,
      uzatildi, kp: o.kp, uchrashuv: uchr.length, muddatli: mudd.size, otkaz, uz7: uzatish7(v, d, u),
      q, belgilanmagan: o.belgilanmagan, qoldiq: v.qoldiq?.[u] || 0, bayroq, odooIshlangan: t("1007", u),
      ids: { ishlangan: ishIds, yangi: o.yangiIds.map(String), eski: o.eskiIds.map(String), kotarmadi: o.kotarmadiLid.map(String), kp: o.kpIds.map(String),
             muddatli: [...mudd], uchrashuv: uchr, belgilanmagan: o.belgilanmaganIds.map(String), ...s } });
  }
  return out;   // v2: tartib va o'rin — hisobot() ichida, ball qo'shilgandan keyin (tartibla)
}
// v2 reyting: uzatgani soni, keyin AI ball, keyin ishlangan lid. O'rin (medal) — kamida bitta uzatganlarga.
function tartibla(rows, op) {
  rows.sort((a, b) => (b.uzatildi - a.uzatildi) || ((b.ball ?? -1) - (a.ball ?? -1)) || (b.ishlangan - a.ishlangan) || (b.yangi - a.yangi) || a.ism.localeCompare(b.ism));
  let n = 0; for (const r of rows) r.orin = !op && r.uzatildi > 0 ? ++n : null;   // operatorga o'rin ko'rsatilmaydi (faqat o'zi bor)
}

// Kun bo'yicha ishlangan lidlar soni (operatorlar birlashmasi — bir lidni ikki operator ishlasa bir marta)
function ishKun(v, d, op) {
  const ids = new Set(), ok = operatorlar(v, d);
  for (const [u, o] of Object.entries(v.kunlar?.[d]?.ops || {})) if (u && ok.has(u) && (!op || u === op)) for (const id of ishIdsOf(o)) ids.add(id);
  return ids.size;
}
function kartalar(v, D, oldin, op) {
  const mk = (id) => ({ bugun: plit(v, D, id, op), oldin: oldin ? plit(v, oldin, id, op) : null });
  const tushgan = mk("1006"), uzatildi = mk("863"), otkaz = mk("791");
  const ishlangan = { bugun: ishKun(v, D, op), oldin: oldin ? ishKun(v, oldin, op) : null, odoo: plit(v, D, "1007", op) };
  const U = uzatish7(v, D, op);
  return { tushgan, ishlangan, uzatildi, otkaz,
    uzatish: { bugun: U.pct, oldin: oldin ? uzatish7(v, oldin, op).pct : null, uzatildi: U.u, yangi: U.y, kun: 7 } };
}

function kunQatori(v, d, op) {
  const k = v.kunlar?.[d];
  const cm = new Set((v.callMarkaz || []).map(String));
  let q = 0, qj = 0;
  for (const [u, o] of Object.entries(k?.ops || {})) if ((op ? u === op : cm.has(u))) { q += qildi(o.q); qj += o.q?.javobli || 0; }
  const ish = ishKun(v, d, op), uz = plit(v, d, "863", op), tu = plit(v, d, "1006", op);
  return { d, qisqa: qisqaKun(d), hafta: new Date(d + "T00:00:00Z").getUTCDay(), tushgan: tu, ishlangan: ish, uzatildi: uz,
    konv: uzatish7(v, d, op).pct, otkaz: plit(v, d, "791", op), qongiroq: q, javobli: qj };
}

// Call-markazdan tashqari xodimlarning qo'ng'iroqlari (menejerlar) — izoh uchun
function tashqi(v, d) {
  const cm = new Set((v.callMarkaz || []).map(String));
  return Object.entries(v.kunlar?.[d]?.ops || {}).filter(([u, o]) => u && !cm.has(u) && (o.q?.jami || 0) > 0)
    .map(([u, o]) => ({ id: u, ism: /^public user$/i.test(v.ismlar?.[u] || "") ? "biriktirilmagan (Public user)" : v.ismlar?.[u] || `#${u}`, qongiroq: o.q.jami }))
    .sort((a, b) => b.qongiroq - a.qongiroq);
}

// sana — Toshkent kuni (YYYY-MM-DD); operator — faqat shu operator (operator roli); lidlar — ro'yxat (jadvaldan bosilganda)
export async function hisobot(db, { sana = null, operator = null, fresh = false, lidlar = false } = {}) {
  const c = client();
  if (!c) return { ulangan: false, sabab: "Panel Odoo adapteriga ulanmagan — kunlik hisobot faqat Odoo manbasida ishlaydi." };
  const D = /^\d{4}-\d{2}-\d{2}$/.test(sana || "") ? sana : bugun();
  if (D > bugun()) throw bad("Kelajakdagi sana tanlandi");
  const r = await c.call("sun.daily", { from: kunQosh(D, -36), to: D, ...(fresh ? { fresh: "1" } : {}), ...(lidlar ? { lid_kun: D } : {}) });
  const v = r.result || {};
  const S = sozlama(db);
  const op = operator ? String(operator) : null;
  let oldin = null;
  for (let i = 1; i <= 7; i++) { const d = kunQosh(D, -i); if (faolKun(v, d)) { oldin = d; break; } }
  const ishIds = (d) => Object.entries(v.kunlar?.[d]?.ops || {}).filter(([u]) => !op || u === op).flatMap(([, o]) => ishIdsOf(o));
  // Manba tugmachalari: son + lidlar ro'yxati (bosilganda tafsilot). Operator — faqat o'z lidlari (son ham, ro'yxat ham).
  const kD = v.kunlar?.[D] || {};
  const opYangi = op ? new Set((kD.ops?.[op]?.yangiIds || []).map(String)) : null;
  const manba = (kD.manbaIds
    ? Object.entries(kD.manbaIds).map(([n, arr]) => { const ids = arr.map(String).filter((i) => !opYangi || opYangi.has(i)); return { n, c: ids.length, ids }; })
    : Object.entries(kD.manba || {}).map(([n, c]) => ({ n, c, ids: [] })))   // eski adapter — faqat son
    .filter((m) => m.c > 0).sort((a, b) => b.c - a.c);
  const Q = sifat.ofLeads(db, [...ishIds(D), ...(oldin ? ishIds(oldin) : []), ...manba.flatMap((m) => m.ids)]);
  const rows = qatorlar(v, D, S, Q, op);
  // v2: AI ball — shu kun va taqqoslash kuni (o'sha operatorlar); manba 20 s da javob bermasa — ballsiz
  const ballOl = async (d) => {
    if (!BALL || !d) return null;
    try { return await Promise.race([BALL(d), new Promise((r) => { const t = setTimeout(() => r(null), 20000); t.unref?.(); })]); } catch { return null; }
  };
  const [bB, bO] = await Promise.all([ballOl(D), ballOl(oldin)]);
  for (const r of rows) { const x = bB?.ops?.[r.id]; r.ball = x && x.n ? Math.round(x.s / x.n) : null; r.tahlil = x ? x.n : 0; }
  const ballJam = (b) => { if (!b) return { ball: null, n: 0 }; let s = 0, n = 0; for (const r of rows) { const x = b.ops?.[r.id]; if (x) { s += x.s; n += x.n; } } return { ball: n ? Math.round(s / n) : null, n }; };
  const jb = ballJam(bB), jo = ballJam(bO);
  tartibla(rows, op);
  const seriya = [];
  for (let i = 29; i >= 0; i--) seriya.push(kunQatori(v, kunQosh(D, -i), op));
  const jam = (f) => rows.reduce((a, x) => a + (Number(x[f]) || 0), 0);
  const out = {
    ulangan: true, sana: D, sanaNomi: kunNomi(D), qisqa: qisqaKun(D), bugunmi: D === bugun(),
    oldin, oldinNomi: oldin ? kunNomi(oldin) : null, oldinQisqa: oldin ? qisqaKun(oldin) : null, kechami: oldin === kunQosh(D, -1),
    faol: faolKun(v, D), operator: op,
    sozlama: S, xabar: oxirgiXabar(db),
    kpi: { ...kartalar(v, D, oldin, op), ball: { bugun: jb.ball, oldin: oldin ? jo.ball : null, tahlil: jb.n } },
    jami: { sifatli: jam("sifatli"), sifatsiz: jam("sifatsiz"), noaniq: jam("noaniq"), baholanmagan: jam("baholanmagan"), kval: jam("kval"),
            eski: jam("eski"), kotarmadi: jam("kotarmadi"), kp: jam("kp"), uchrashuv: jam("uchrashuv"), muddatli: jam("muddatli"),
            belgilanmagan: jam("belgilanmagan"), qongiroq: rows.reduce((a, x) => a + x.q.qildi, 0), kirJavobsiz: rows.reduce((a, x) => a + (x.q.kirJavobsiz || 0), 0),
            sek: rows.reduce((a, x) => a + x.q.sek, 0), javobli: rows.reduce((a, x) => a + (x.q.javobli || 0), 0),
            yangi: jam("yangi"), ishlangan: jam("ishlangan"), uzatildi: jam("uzatildi"), ball: jb.ball, tahlil: jb.n },
    ballBor: !!bB,
    rows, seriya,
    manba,
    operatorsiz: op ? null : v.kunlar?.[D]?.plit?.["1006"]?.ops?.[""] || 0,
    tashqi: op ? [] : tashqi(v, D),
    at: v.at, oyna: v.oyna, voip: v.voip, manbaIzoh: v.manba,
  };
  if (lidlar) {
    // Operator roli — faqat o'z qatori va o'z manba lidlari (ilgari javobda butun kunning lidlari ketardi)
    const ruxsat = op ? new Set([...rows.flatMap((x) => Object.values(x.ids || {}).flat()), ...manba.flatMap((m) => m.ids)].map(String)) : null;
    const L = {};
    for (const [id, x] of Object.entries(v.lidlar || {})) {
      if (ruxsat && !ruxsat.has(String(id))) continue;
      const q = Q.get(id); L[id] = { ...x, sifat: q ? { v: q.verdict, r: q.reason, q: q.quote, s: q.signals } : null };
    }
    out.lidlar = L;
    // Kun xaritasi (operator oynasi): qo'ng'iroqlar vaqti — operator roli faqat o'zinikini oladi
    const QV = v.qongiroqlar || {};
    out.qongiroqlar = op ? { [op]: QV[op] || [] } : QV;
  }
  return out;
}

// ---- Rasm (PNG) ----
export function pngData(rep) {
  return { sanaNomi: rep.sanaNomi, qisqa: rep.qisqa, bugunmi: rep.bugunmi, oldinQisqa: rep.oldinQisqa, kechami: rep.kechami,
    kpi: rep.kpi, jami: rep.jami, sozlama: { sariq: rep.sozlama.sariq, qizil: rep.sozlama.qizil, norma: rep.sozlama.norma },
    rows: rep.rows.map(({ ids, ...r }) => r), seriya: rep.seriya.slice(-7), manba: rep.manba.slice(0, 4).map(({ n, c }) => ({ n, c })),
    operatorsiz: rep.operatorsiz, holat: tk().slice(11, 16), panel: PANEL.replace(/^https?:\/\//, "") };
}
export function png(rep) {
  return new Promise((resolve, reject) => {
    const ch = spawn(process.env.PYTHON || "python3", [path.join(HERE, "..", "tools", "kunlik-png.py")], { stdio: ["pipe", "pipe", "pipe"] });
    const out = []; let err = "";
    const t = setTimeout(() => { ch.kill("SIGKILL"); reject(new Error("Rasm chizish vaqti tugadi")); }, 30000);
    ch.stdout.on("data", (d) => out.push(d));
    ch.stderr.on("data", (d) => { err += d; });
    ch.on("error", (e) => { clearTimeout(t); reject(new Error(`Rasm chizuvchi ishga tushmadi: ${e.message}`)); });
    ch.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(`Rasm chizilmadi: ${err.trim().split("\n").pop() || code}`));
      resolve(Buffer.concat(out));
    });
    ch.stdin.end(JSON.stringify(pngData(rep)));
  });
}

// ---- Telegram (Sarvar boti → «Sotuv bolimi» guruhi) ----
function botEnv() {
  const env = {};
  for (const l of fs.readFileSync(BOT_ENV, "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const pct = (x) => (x === null || x === undefined ? "—" : `${String(x).replace(".", ",")}%`);
export function izoh(rep) {
  const k = rep.kpi, o = rep.oldinQisqa;
  const vs = (x) => (x.oldin === null || x.oldin === undefined ? "" : ` (${rep.kechami ? "kecha" : o} ${x.oldin})`);
  const top = rep.rows.filter((r) => r.orin && r.orin <= 3).map((r) => `${["🥇", "🥈", "🥉"][r.orin - 1]} ${esc(r.ism)} — ${r.uzatildi} uzatdi · ${r.yangi} yangi lid${r.ball != null ? ` · ball ${r.ball}` : ""}`);
  const kech = rep.rows.filter((r) => r.bayroq.some((b) => b.k === "faollik")).map((r) => `${esc(r.ism)} (${r.birinchi || "faollik yo'q"})`);
  const kam = rep.rows.filter((r) => r.bayroq.some((b) => b.k === "qongiroq")).map((r) => `${esc(r.ism)} (${r.q.qildi})`);
  return [
    `📊 <b>Call-markaz kunlik hisoboti · ${esc(rep.sanaNomi)}</b>`,
    `Yangi lid: <b>${k.tushgan.bugun}</b>${vs(k.tushgan)} · Uzatildi: <b>${k.uzatildi.bugun}</b>${vs(k.uzatildi)} · Uzatish (7 kun): <b>${pct(k.uzatish.bugun)}</b>`,
    `Ishlangan: ${k.ishlangan.bugun} · Yo'qotilgan: ${k.otkaz.bugun} · AI ball: ${k.ball?.bugun ?? "—"} · sifatli ${rep.jami.sifatli}, sifatsiz ${rep.jami.sifatsiz}`,
    top.length ? `\n${top.join("\n")}` : "",
    kech.length ? `\n⚠️ Kech boshlagan: ${kech.join(", ")}` : "",
    kam.length ? `📞 Normadan kam: ${kam.join(", ")}` : "",
    `\n<a href="${PANEL}">Sotuv Desk — batafsil</a>`,
  ].filter(Boolean).join("\n").slice(0, 1020);
}
// Oddiy matnli xabar (issiq lid ogohlantirishi va h.k.) — xuddi shu bot; chat bo'sh bo'lsa «Sotuv bolimi» guruhi
export async function tgMatn(text, chat = null) {
  let env; try { env = botEnv(); } catch { throw bad("Telegram sozlamasi o'qilmadi (Sarvar boti .env)", 500); }
  const token = env.TELEGRAM_BOT_TOKEN, c = chat || process.env.KUNLIK_CHAT_ID || env.GROUP_CHAT_ID;
  if (!token || !c) throw bad("Telegram bot tokeni yoki chat ID topilmadi", 500);
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: c, text: String(text).slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }), signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw bad(`Telegram: ${String(j.description || "HTTP " + r.status).slice(0, 160)}`, 502);
  return { msg: j.result?.message_id || null, chat: String(c) };
}
export async function yubor(db, rep, { actor = "?", auto = false } = {}) {
  let env;
  try { env = botEnv(); } catch { throw bad("Telegram sozlamasi o'qilmadi (Sarvar boti .env)", 500); }
  const token = env.TELEGRAM_BOT_TOKEN, chat = process.env.KUNLIK_CHAT_ID || env.GROUP_CHAT_ID;
  if (!token || !chat) throw bad("Telegram bot tokeni yoki guruh ID topilmadi (Sarvar sozlamasi)", 500);
  const img = await png(rep);
  const fd = new FormData();
  fd.append("chat_id", chat);
  fd.append("caption", izoh(rep));
  fd.append("parse_mode", "HTML");
  fd.append("photo", new Blob([img], { type: "image/png" }), `kunlik-${rep.sana}.png`);
  const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: fd, signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw bad(`Telegram: ${String(j.description || "HTTP " + r.status).slice(0, 160)}`, 502);
  const info = { at: new Date().toISOString(), actor, auto, sana: rep.sana, msg: j.result?.message_id || null, chat: String(chat), bytes: img.length };
  setKey(db, "xabar", JSON.stringify(info));
  if (auto) setKey(db, "oxirgi", rep.sana);
  return info;
}

// ---- Avtoyuborish: har daqiqa tekshiriladi (cron emas — panel xizmatining o'zida) ----
// Belgilangan vaqtdan keyingi 3 soat ichida, kuniga bir marta. Vaqt 12:00 dan oldin bo'lsa —
// kechagi kun hisoboti (ish boshida), keyin bo'lsa — bugungi (ish oxirida). Faoliyat bo'lmagan
// kun (yakshanba, bayram) yuborilmaydi.
let rejaBand = false, rejaXato = 0;
export function rejalashtir(db, log = console.log, auditYoz = () => {}) {
  const tick = async () => {
    if (rejaBand) return;
    const S = sozlama(db);
    if (S.auto !== "on" || !HM.test(S.vaqt)) return;
    const now = tk(), sana = now.slice(0, 10), hm = now.slice(11, 16);
    if (hm < S.vaqt || (S.boshlanish && sana < S.boshlanish)) return;
    const daq = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5));
    if (daq(hm) - daq(S.vaqt) > 180) return;                       // 3 soatdan kech — o'tkaziladi (tunda xabar yo'q)
    const kun = S.vaqt < "12:00" ? kunQosh(sana, -1) : sana;
    if (S.oxirgi && S.oxirgi >= kun) return;
    if (Date.now() - rejaXato < 10 * 60e3) return;                   // xatodan keyin 10 daqiqa kutiladi
    rejaBand = true;
    try {
      const rep = await hisobot(db, { sana: kun, fresh: true });
      if (!rep.ulangan) throw new Error(rep.sabab);
      if (!rep.faol) { setKey(db, "oxirgi", kun); log(`kunlik hisobot ${kun}: faoliyat yo'q — yuborilmadi`); auditYoz("kunlik.skip", kun, "faoliyat yo'q"); return; }
      const r = await yubor(db, rep, { actor: "avtomat", auto: true });
      log(`kunlik hisobot ${kun} guruhga yuborildi (xabar ${r.msg}, ${Math.round(r.bytes / 1024)} KB)`);
      auditYoz("kunlik.send", kun, `avtomat · xabar ${r.msg}`);
    } catch (e) { rejaXato = Date.now(); log(`kunlik hisobot XATO: ${e.message}`); auditYoz("kunlik.error", kun, String(e.message).slice(0, 200)); }
    finally { rejaBand = false; }
  };
  const tim = setInterval(() => { tick().catch(() => {}); }, 60e3); tim.unref?.();
  setTimeout(() => { tick().catch(() => {}); }, 30e3).unref?.();
}
