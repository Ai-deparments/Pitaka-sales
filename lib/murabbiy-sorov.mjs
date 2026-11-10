// Murabbiy — kechikkan lidlar sababi (2026-11-02). Sotuv rahbari (CLI orqali) so'raydi, bot har bir botga ulangan
// operatordan «nega kechikdi» deb so'raydi, javoblar muddatdan keyin rahbarga xulosa bo'lib boradi.
// Bu modul faqat BAZA bilan ishlaydi: yuborish murabbiy.mjs dagi sorovTick'da (CLI Telegram'ga umuman tegmaydi).
import * as ert from "./ertalab.mjs";
import { ishBoshi } from "./murabbiy-vazifa.mjs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const kes = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
export const MAX_QATOR = 10;     // bitta xabarda ko'pi bilan shuncha lid
const MAX_JAVOB = 1000;
const TZ = 5 * 3600e3;
const tkVaqt = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? new Date(t + TZ).toISOString().slice(0, 16).replace("T", " ") : "—"; };

const _init = new WeakSet();
export function init(db) {
  if (_init.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_sorov (
      id INTEGER PRIMARY KEY AUTOINCREMENT, mavzu TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT,
      muddat TEXT NOT NULL, xulosa_at TEXT,
      ulanmagan TEXT                      -- JSON {lid, owners:[...]} — botga ulanmagan operatorlar (savol ketmagan)
    );
    CREATE TABLE IF NOT EXISTS coach_sorov_q (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sorov_id INTEGER NOT NULL, user_id INTEGER NOT NULL, owner TEXT NOT NULL,
      items TEXT NOT NULL,                -- JSON [{id,title,hours}] eng uzoq kutgani birinchi
      chat_id TEXT NOT NULL, msg_id INTEGER, sent_at TEXT, javob TEXT, javob_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_csq_sorov ON coach_sorov_q(sorov_id);
    CREATE INDEX IF NOT EXISTS idx_csq_chat ON coach_sorov_q(chat_id, sent_at);
  `);
  _init.add(db);
}

// rows — sla.atRisk: {id,title,owner,hours}. Faqat coach_links (paused=0) ga ulangan operatorlarga savol yoziladi.
export function yarat(db, { mavzu, rows, muddatSoat = 4, by = null }, now = Date.now()) {
  init(db);
  const guruh = new Map();
  let masulsiz = 0;
  for (const r of rows || []) {
    const o = String(r.owner ?? "").trim();
    if (!o) { masulsiz++; continue; }                                // R15
    if (!guruh.has(o)) guruh.set(o, []);
    guruh.get(o).push({ id: String(r.id), title: kes(ert.yashir(r.title), 80), hours: Math.round(Number(r.hours) || 0) });
  }
  const link = db.prepare(`SELECT l.user_id, l.chat_id FROM coach_links l JOIN users u ON u.id=l.user_id
    WHERE l.paused=0 AND TRIM(u.bitrix_user_id)=? ORDER BY l.user_id LIMIT 1`);
  const ulangan = [], ulanmagan = []; let ulanmaganLid = 0;
  for (const [o, items] of guruh) {
    if (o === "?") { masulsiz += items.length; continue; }          // R15: mas'ul ko'rsatilmagan — operator emas
    items.sort((a, b) => b.hours - a.hours);
    const l = link.get(o);
    if (l) ulangan.push({ o, items, l }); else { ulanmagan.push(o); ulanmaganLid += items.length; }
  }
  // Ish vaqtidan tashqarida yaratilsa savollar keyingi ish oynasida ketadi — javob soati ham o'sha paytdan boshlanadi
  const bosh = ishBoshi(now);
  const muddat = new Date(bosh + Math.max(0.01, Number(muddatSoat) || 4) * 3600e3).toISOString();
  const { lastInsertRowid } = db.prepare("INSERT INTO coach_sorov (mavzu, created_at, created_by, muddat, ulanmagan) VALUES (?,?,?,?,?)")
    .run(String(mavzu || "Kechikkan lidlar"), new Date(now).toISOString(), by, muddat, JSON.stringify({ lid: ulanmaganLid, owners: ulanmagan, masulsiz }));
  const ins = db.prepare("INSERT INTO coach_sorov_q (sorov_id, user_id, owner, items, chat_id) VALUES (?,?,?,?,?)");
  for (const x of ulangan) ins.run(lastInsertRowid, x.l.user_id, x.o, JSON.stringify(x.items), x.l.chat_id);
  return { id: Number(lastInsertRowid), ulangan: ulangan.length, ulanmagan, ulanmaganLid, masulsiz, muddat, bosh: new Date(bosh).toISOString(), kechikib: bosh > now };
}

// Yuborilmagan savollar: muddati o'tmagan so'rovdan, operator hanuz ulangan (paused=0) bo'lsa. Chat — joriy ulanishdan.
export function yuboriladi(db, now = Date.now()) {
  init(db);
  return db.prepare(`SELECT q.*, s.mavzu, l.chat_id cur_chat FROM coach_sorov_q q JOIN coach_sorov s ON s.id=q.sorov_id
    JOIN coach_links l ON l.user_id=q.user_id AND l.paused=0
    WHERE q.sent_at IS NULL AND s.muddat>? ORDER BY q.id`).all(new Date(now).toISOString());
}
// chatId — savol HAQIQATDA yuborilgan chat (yaratilgandan keyin qayta ulangan bo'lsa javobQabul to'g'ri chatni topsin)
export function yuborildi(db, qid, msgId, now = Date.now(), chatId = null) {
  db.prepare("UPDATE coach_sorov_q SET msg_id=?, sent_at=?, chat_id=COALESCE(?, chat_id) WHERE id=?")
    .run(msgId ?? null, new Date(now).toISOString(), chatId != null ? String(chatId) : null, qid);
}
export function xabar(q) {
  const items = JSON.parse(q.items);
  const qator = items.slice(0, MAX_QATOR).map((x, i) => `${i + 1}. ${esc(x.title || "Nomsiz lid")} — ${x.hours} soat`);
  const yana = items.length - MAX_QATOR;
  return [`📋 <b>Kechikkan lidlar — sabab kerak</b>`, `<i>${esc(kes(q.mavzu, 100))}</i>`, "", ...qator,
    ...(yana > 0 ? [`…va yana ${yana} ta`] : []), "",
    "Har biri bo'yicha qisqa sabab yozing (bitta xabarda). Javobni shu chatga yozing."].join("\n");
}

// Shu chatdagi ochiq savolga javob. Reply bo'lsa o'sha savol, bo'lmasa eng oxirgi yuborilgani. Birinchi javob g'olib.
export function javobQabul(db, chatId, text, replyToMsgId, now = Date.now()) {
  init(db);
  const t = String(text ?? "").trim();
  if (!t) return false;
  const och = db.prepare(`SELECT q.id, q.msg_id FROM coach_sorov_q q JOIN coach_sorov s ON s.id=q.sorov_id
    WHERE q.chat_id=? AND q.sent_at IS NOT NULL AND q.javob IS NULL AND s.muddat>? ORDER BY q.sent_at DESC, q.id DESC`)
    .all(String(chatId), new Date(now).toISOString());
  if (!och.length) return false;
  const q = (replyToMsgId != null && och.find((x) => x.msg_id === Number(replyToMsgId))) || och[0];
  db.prepare("UPDATE coach_sorov_q SET javob=?, javob_at=? WHERE id=?").run(t.slice(0, MAX_JAVOB), new Date(now).toISOString(), q.id);
  return true;
}

export function oxirgiId(db) { init(db); return db.prepare("SELECT MAX(id) id FROM coach_sorov").get().id ?? null; }
export function tugagan(db, now = Date.now()) {
  init(db);
  return db.prepare("SELECT id FROM coach_sorov WHERE xulosa_at IS NULL AND muddat<=? ORDER BY id").all(new Date(now).toISOString());
}
export function xulosalandi(db, id, now = Date.now()) {
  db.prepare("UPDATE coach_sorov SET xulosa_at=? WHERE id=?").run(new Date(now).toISOString(), id);
}

// {html, text, javob, javobsiz, id} yoki null. html — Telegram uchun (hammasi esc), text — CLI uchun (oddiy matn).
export function natija(db, id) {
  init(db);
  const s = db.prepare("SELECT * FROM coach_sorov WHERE id=?").get(id);
  if (!s) return null;
  const qs = db.prepare(`SELECT q.*, COALESCE(NULLIF(u.name,''), u.login, q.owner) nom FROM coach_sorov_q q
    LEFT JOIN users u ON u.id=q.user_id WHERE q.sorov_id=? ORDER BY (q.javob IS NULL), q.id`).all(id);
  const javob = qs.filter((q) => q.javob != null).length, javobsiz = qs.length - javob;
  let ul = { lid: 0, owners: [], masulsiz: 0 };
  try { ul = { ...ul, ...(JSON.parse(s.ulanmagan) || {}) }; } catch {}
  const ulSatr = [ul.owners.length ? `botga ulanmagan: ${ul.lid} lid, ${ul.owners.length} operator` : "",
    ul.masulsiz ? `mas'ulsiz: ${ul.masulsiz} lid` : ""].filter(Boolean).join("\n");
  const sarlavha = `So'rov #${s.id}: ${kes(s.mavzu, 100)} — javob berdi ${javob}, bermadi ${javobsiz}`;
  // Telegram 4096 belgi: javob uzunligi operatorlar soniga qarab qisqartiriladi, ~3800 belgidan keyin «…va yana K ta operator».
  const BUDJET = 3800, jAx = qs.length > 8 ? 200 : 400;
  const bosh = [`📋 <b>${esc(`So'rov #${s.id}`)}: ${esc(kes(s.mavzu, 100))}</b>`, `Javob berdi: <b>${javob}</b> · bermadi: <b>${javobsiz}</b>`, ""];
  const quyruq = ulSatr ? "\n\n" + esc(ulSatr) : "";
  const satr = [];
  let uz = bosh.join("\n").length + quyruq.length + 120;
  for (const q of qs) {
    const l = `• <b>${esc(kes(q.nom, 60))}</b> — ${JSON.parse(q.items).length} lid\n  ${q.javob != null ? esc(kes(q.javob, jAx)) : "⏳ javob bermadi"}`;
    if (uz + l.length + 1 > BUDJET) break;
    satr.push(l); uz += l.length + 1;
  }
  const qolgan = qs.length - satr.length;
  const html = [...bosh, ...satr, ...(qolgan > 0 ? [`…va yana ${qolgan} ta operator (to'liq: CLI natija #${s.id})`] : [])].join("\n") + quyruq;
  const text = [sarlavha, "", ...qs.map((q) => `- ${q.nom} (${JSON.parse(q.items).length} lid): ${q.javob != null ? q.javob : "⏳ javob bermadi"}`),
    ...(ulSatr ? ["", ulSatr] : [])].join("\n");
  return { id: s.id, html, text, javob, javobsiz };
}

// ---- CLI mantig'i (tarmoqsiz sinaladi) ----
export function kechikkan(db, { rows, soat = 4, by = "cli", mavzu = null }, now = Date.now()) {
  const m = mavzu || `Kechikkan lidlar (${(rows || []).length} ta)`;
  const r = yarat(db, { mavzu: m, rows, muddatSoat: soat, by }, now);
  return [`So'rov #${r.id} yaratildi (${m}).`,
    `Savol yuboriladigan (ulangan: ${r.ulangan} operator).`,
    ...(r.masulsiz ? [`Mas'ulsiz: ${r.masulsiz} lid (mas'ul ko'rsatilmagan, savol ketmaydi).`] : []),
    `Botga ulanmagan: ${r.ulanmaganLid} lid — ulanmagan: ${r.ulanmagan.length} operator${r.ulanmagan.length ? ` (CRM ID: ${r.ulanmagan.join(", ")})` : ""}.`,
    `Javob muddati: ${tkVaqt(r.muddat)} (Toshkent). ${r.kechikib
      ? `Ish vaqtidan tashqari — savollar ${tkVaqt(r.bosh)} (Toshkent) da yuboriladi.`
      : "Savollarni panel jarayoni 1 daqiqada yuboradi (hozir)."}`].join("\n");
}
export function natijaMatn(db, id = null) {
  const i = id == null ? oxirgiId(db) : Number(id);
  if (i == null) return "Hali so'rov yo'q.";
  return natija(db, i)?.text ?? `So'rov #${i} topilmadi.`;
}
export function holatMatn(db, kun = 7, now = Date.now()) {
  const dan = new Date(now - Math.max(1, Number(kun) || 7) * 864e5).toISOString();
  const rows = db.prepare(`SELECT COALESCE(NULLIF(u.name,''), u.login, t.owner) nom,
      COUNT(*) jami,
      SUM(t.state='bajarildi' AND t.closed_by='tekshiruv') tek, SUM(t.state='bajarildi' AND t.closed_by='operator') op,
      SUM(t.state='bajarildi') baj, SUM(t.state='ochiq') ochiq, SUM(t.state='kechikdi') kech
    FROM coach_tasks t LEFT JOIN users u ON u.id=t.user_id WHERE t.created_at>=? GROUP BY t.user_id ORDER BY jami DESC`).all(dan);
  const s = [`Murabbiy vazifalari — oxirgi ${Number(kun) || 7} kun`];
  if (!rows.length) return s.concat("Vazifa berilmagan.").join("\n");
  for (const r of rows) s.push(`${r.nom}: berildi ${r.jami}, bajarildi ${r.baj} (tekshiruv ${r.tek}, operator ${r.op}), ochiq ${r.ochiq}, kechikkan ${r.kech}`);
  return s.join("\n");
}
