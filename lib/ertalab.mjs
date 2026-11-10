// Ertalabki xabar — sotuvchiga soat 09:00 da (Toshkent) O‘Z ochiq bitimlaridan keyingi qadami
// belgilanmaganlari (2026-10-29).
//
// Qoidalar (buzilmaydi):
//   • Har kim faqat O‘Z bitimlarini oladi: bitim mas'uli (ASSIGNED_BY_ID) = panel hisobidagi CRM ID.
//   • Faqat Murabbiy botiga O‘ZI ulangan va to‘xtatmagan (paused=0) sotuvchilarga — kuniga bir marta.
//   • Mijozning telefoni, pochtasi va CRM ID si xabarga tushmaydi: bitim nomida bo‘lsa ham yashiriladi.
//   • Bu fayl tarmoqqa chiqmaydi. xabar() faqat matn yig‘adi, yuborishni chaqiruvchi qiladi
//     (murabbiy.mjs → yubor). Bazaga faqat init() (jadval) va belgila() yozadi.
//
// Ma'lumot: hygiene.mjs scan() qatorlari — {id, title, owner, stage, amount, currency, idleDays,
// issues: ["qadam", "sana", …], archive}. worklist(bx, owner, "qadam") qatorlari ham mos keladi.
import { SELLER } from "./roles.mjs";

export const VAQT_STD = "09:00";   // ertalabki xabar vaqti (Toshkent)
export const OYNA_STD = 180;       // shu vaqtdan keyin necha daqiqa ichida yuborish mumkin
export const TOP = 5;              // xabarda nechta bitim nomi bilan ko‘rsatiladi

// ---------------------------------------------------------------- yordamchilar (murabbiy.mjs bilan bir xil)
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const kes = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const TZ = 5 * 3600e3;
const tkIso = (ms = Date.now()) => new Date(ms + TZ).toISOString();    // Toshkent devor soati («Z» shartli)
const OY = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const sanaUz = (s) => `${+s.slice(8, 10)}-${OY[+s.slice(5, 7) - 1]}`;
const daq = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const SANA = /^\d{4}-\d{2}-\d{2}$/;
const xato = (msg) => Object.assign(new Error(msg), { status: 400 });
const vaqtMs = (v) => { const t = Number(v); return Number.isFinite(t) ? t : Date.now(); };

// Toshkent bo‘yicha sana YYYY-MM-DD — kimga()/belgila() ga shu beriladi (vaqtmi bilan bir xil `now`)
export const sanaTk = (ms = Date.now()) => tkIso(vaqtMs(ms)).slice(0, 10);

// Pul: 12500000 → «12 500 000 so‘m». ICU'ga bog‘liq emas — server va test bir xil chiqaradi.
const son = (n) => String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const summa = (n, cur) => `${son(n)} ${!cur || String(cur).toUpperCase() === "UZS" ? "so‘m" : String(cur)}`;

// Shaxsiy ma'lumot: bitim nomida mijoz telefoni yoki pochtasi bo‘lishi mumkin (lid nomidan o‘tadi).
// Telefon — 9+ raqam (90 123 45 67, +998 90 123-45-67, (90) 1234567). Bo‘shliq bilan uchlab
// guruhlangan summa («450 000 000») telefon emas — qoladi; 998 bilan boshlangan 12 raqam — doim telefon.
const POCHTA = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const TEL = /[+(]?\d(?:[\s\-()]*\d){8,}/g;
export const yashir = (s) => String(s ?? "")
  .replace(POCHTA, "[pochta]")
  .replace(TEL, (m) => {
    const raq = m.replace(/\D/g, "");
    if (!/^\+/.test(m) && !/^998\d{9}$/.test(raq) && /^\d{1,3}(?: \d{3})+$/.test(m.trim())) return m;
    return "[tel]";
  });

// ---------------------------------------------------------------- sxema
const _init = new WeakSet();
export function init(db) {
  if (_init.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_morning (
      user_id INTEGER NOT NULL,
      day     TEXT NOT NULL,               -- Toshkent sanasi YYYY-MM-DD
      sent_at TEXT,                        -- ISO UTC
      note    TEXT,                        -- null: yuborildi | «qadamsiz bitim yo‘q» | «xato: …»
      PRIMARY KEY (user_id, day)
    );
  `);
  _init.add(db);
}

// ---------------------------------------------------------------- xabar matni
const raqam = (v) => (v != null && Number.isFinite(+v) ? +v : 0);
const qadamsiz = (rows, owner) => (Array.isArray(rows) ? rows : []).filter((r) =>
  r && String(r.owner) === String(owner) && !r.archive && Array.isArray(r.issues) && r.issues.includes("qadam"));

const MASLAHAT = "💡 Har biriga keyingi qadamni sana bilan qo‘ying: CRM’da vazifa yoki qo‘ng‘iroq rejalashtiring — masalan, «Ertaga 11:00 — hisob va 2 variantli taklifni yuborish».";

// Bitta qator: nom — bosqich, N kun harakatsiz · summa. Har o‘zgaruvchan qiymat esc() dan o‘tadi.
function qator(r) {
  const nom = esc(kes(yashir(r.title), 40) || "Nomsiz bitim");
  const bosq = esc(kes(yashir(r.stage), 30));
  const kun = r.idleDays != null && Number.isFinite(+r.idleDays) ? Math.max(0, Math.floor(+r.idleDays)) : null;
  const tafsil = [bosq, kun == null ? "" : kun ? `${kun} kun harakatsiz` : "bugun harakat bo‘lgan"].filter(Boolean).join(", ");
  const pul = raqam(r.amount) > 0 ? ` · <b>${esc(summa(raqam(r.amount), r.currency))}</b>` : "";
  return `• ${nom}${tafsil ? ` — ${tafsil}` : ""}${pul}`;
}

// rows — hygiene scan() qatorlari (hamma egalar aralash bo‘lishi mumkin), owner — sotuvchining CRM ID si.
// Qaytaradi: { html, url, n } yoki null (yuboradigan narsa yo‘q). url — faqat https panel bo‘lsa (Telegram talabi).
export function xabar(rows, owner, { now = Date.now(), panelUrl } = {}) {
  if (owner == null || String(owner).trim() === "") return null;
  const list = qadamsiz(rows, String(owner).trim());
  if (!list.length) return null;
  const top = [...list]
    .sort((a, b) => raqam(b.amount) - raqam(a.amount) || raqam(b.idleDays) - raqam(a.idleDays))
    .slice(0, TOP);
  const L = [
    `☀️ <b>Xayrli tong!</b> · ${sanaUz(sanaTk(now))}`,
    `Keyingi qadami belgilanmagan bitimlaringiz: <b>${list.length}</b> ta`,
    "",
    ...top.map(qator),
  ];
  if (list.length > TOP) L.push(`…va yana ${list.length - TOP} ta`);
  L.push("", MASLAHAT);
  const base = typeof panelUrl === "string" ? panelUrl.trim().replace(/\/+$/, "") : "";
  const url = /^https:\/\/[^\s/]+/.test(base) ? `${base}/#gigiena` : undefined;
  return { html: L.join("\n"), url, n: list.length };
}

// ---------------------------------------------------------------- vaqt
// Toshkent (UTC+5) bo‘yicha [vaqt, vaqt+oyna] ichidami va ish kunimi (1=dushanba … 7=yakshanba).
// Oyna yarim tundan o‘tmaydi deb olinadi (09:00 + 3 soat — muammo yo‘q).
export function vaqtmi(nowMs, { vaqt = VAQT_STD, oyna = OYNA_STD, ishKunlari = [1, 2, 3, 4, 5, 6] } = {}) {
  const t = Number(nowMs);
  if (!Number.isFinite(t)) return false;
  const v = HM.test(String(vaqt)) ? String(vaqt) : VAQT_STD;
  const w = Number.isFinite(+oyna) && +oyna >= 0 ? +oyna : OYNA_STD;
  const d = new Date(t + TZ);
  const hafta = d.getUTCDay() || 7;
  if (!Array.isArray(ishKunlari) || !ishKunlari.map(Number).includes(hafta)) return false;
  const farq = d.getUTCHours() * 60 + d.getUTCMinutes() - daq(v);
  return farq >= 0 && farq <= w;
}

// ---------------------------------------------------------------- kimga
// Bugun hali ertalabki xabar olmagan: ulangan, to‘xtatmagan (paused=0; 2 — botni bloklagan),
// roli SELLER, CRM ID si bor sotuvchilar. → [{user_id, chat_id, owner}]
export function kimga(db, sana) {
  if (!SANA.test(String(sana ?? ""))) throw xato("Sana YYYY-MM-DD ko‘rinishida bo‘lsin");
  init(db);
  const rol = SELLER.map(() => "?").join(",");
  return db.prepare(`SELECT l.user_id, l.chat_id, u.bitrix_user_id owner FROM coach_links l JOIN users u ON u.id=l.user_id
      WHERE l.paused=0 AND u.role IN (${rol})
        AND u.bitrix_user_id IS NOT NULL AND TRIM(u.bitrix_user_id)<>''
        AND NOT EXISTS (SELECT 1 FROM coach_morning m WHERE m.user_id=l.user_id AND m.day=?)
      ORDER BY l.user_id`).all(...SELLER, sana)
    .map((r) => ({ user_id: r.user_id, chat_id: String(r.chat_id), owner: String(r.owner).trim() }));
}

// Yuborildi (yoki yuborishga hojat yo‘q / xato) — shu kuni qayta urinilmaydi.
export function belgila(db, userId, sana, note = null) {
  if (!SANA.test(String(sana ?? ""))) throw xato("Sana YYYY-MM-DD ko‘rinishida bo‘lsin");
  const id = Number(userId);
  if (!Number.isInteger(id)) throw xato("user_id butun son bo‘lsin");
  init(db);
  db.prepare("INSERT OR REPLACE INTO coach_morning (user_id, day, sent_at, note) VALUES (?,?,?,?)")
    .run(id, sana, new Date().toISOString(), note == null ? null : kes(note, 200));
  return true;
}
