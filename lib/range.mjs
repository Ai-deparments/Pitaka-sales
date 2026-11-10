// Sana oralig'i — vaqtga bog'liq barcha tahlillar shu yagona obyekt orqali cheklanadi.
// Hammasi Asia/Tashkent (UTC+5): "2026-09-03" = o'sha kunning 00:00–23:59 Toshkent vaqti.
import { tashkentNow, ymd } from "./bitrix.mjs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_DAYS = 366;      // undan uzun oraliq Bitrix'ni keraksiz yuklaydi
const WEEKLY_FROM = 92;           // 92 kundan uzun oraliqda diagramma haftalik bo'ladi

const utc = (s) => Date.parse(`${s}T00:00:00Z`);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const span = (from, to) => Math.round((utc(to) - utc(from)) / 864e5) + 1;

export const today = () => ymd(tashkentNow());
const ago = (n) => { const t = tashkentNow(); t.setDate(t.getDate() - n); return ymd(t); };

const MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun",
                "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const human = (s) => { const [, m, d] = s.split("-"); return `${+d}-${MONTHS[+m - 1]}`; };

function build(from, to) {
  if (from > to) [from, to] = [to, from];
  const days = span(from, to);
  return {
    from, to, days,
    fromISO: `${from}T00:00:00+05:00`,
    toISO: `${to}T23:59:59+05:00`,
    key: `${from}_${to}`,
    label: from === to ? human(from) : `${human(from)} — ${human(to)}`,
    bucket: days > WEEKLY_FROM ? "week" : "day",
  };
}

// number (nechta kun orqaga) | {from,to} | undefined -> to'liq oraliq.
// Har qanday kirishni qabul qiladi, chunki eski chaqiruvlar hali `days` sonini uzatadi.
export function normalize(input, defDays = 30) {
  // Tayyor «oxirgi N kun» (Odoo kabi, soatigacha) — QAYTA QURILMAYDI. Ilgari bu yerda from/to sanalaridan
  // kalendar oraliq qayta yasalardi: panel 338 (17-sentabr 00:00 dan), Odoo 332 (03:56 dan) — 2026-09-24.
  if (input && typeof input === "object" && input.rolling && input.fromISO && input.toISO) return input;
  if (input && typeof input === "object" && input.from && input.to) return build(input.from, input.to);
  const n = Number.isFinite(+input) && +input > 0 ? Math.min(Math.floor(+input), MAX_DAYS) : defDays;
  return build(ago(n - 1), today());
}

// «Oxirgi N kun» — Odoo (Dashboard Ninja «Last 7/30/90 days») bilan AYNAN bir xil: hozirdan N×24 soat
// orqaga (2026-09-24, egasi: panel 100, Odoo 105 — sabab: panel kalendar kunlarini olardi, Odoo esa
// bosilgan paytdan 168 soat orqaga). Kesh kaliti 5 daqiqalik bo'lak bilan yangilanadi.
export function rolling(days) {
  const now = Date.now(), start = now - days * 864e5;
  const tk = (ms) => new Date(ms + 5 * 3600e3).toISOString();      // Toshkent devor soati
  const from = tk(start).slice(0, 10), to = tk(now).slice(0, 10);
  return {
    from, to, days,
    fromISO: tk(start).slice(0, 19) + "+05:00",
    toISO: tk(now).slice(0, 19) + "+05:00",
    key: `r${days}_${Math.floor(now / 300e3)}`,
    label: `${human(from)} ${tk(start).slice(11, 16)} — hozir (oxirgi ${days} kun)`,
    bucket: days > WEEKLY_FROM ? "week" : "day",
    rolling: true,
  };
}
const ROLLING = { d7: 7, d30: 30, d90: 90 };

// ?from=YYYY-MM-DD&to=YYYY-MM-DD, bo'lmasa ?days=N, u ham bo'lmasa — standart oraliq.
// ?preset=d7|d30|d90 (va to = bugun) — Odoo kabi «oxirgi N kun» (rolling).
// Noto'g'ri format 400 bermaydi: panel hech qachon bo'sh qolmasligi kerak, standartga tushadi.
export function parseRange(q, defDays = 30, maxDays = MAX_DAYS) {
  const from = String(q.get("from") || "");
  const to = String(q.get("to") || "");
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return normalize(q.get("days"), defDays);

  const t = today();
  const pn = ROLLING[String(q.get("preset") || "")];
  if (pn && to === t) return rolling(Math.min(pn, maxDays));
  let r = build(from, to);
  if (r.to > t) r = build(r.from > t ? t : r.from, t);      // kelajak kuni tanlansa — bugungacha
  if (r.days > maxDays) r = build(iso(utc(r.to) - (maxDays - 1) * 864e5), r.to);
  return r;
}

// Oraliqqa tushadigan oylar: ["2026-07", "2026-08", ...] — moliya diagrammasi uchun.
export function eachMonth(r) {
  const out = [];
  let [y, m] = r.from.split("-").map(Number);
  const [ey, em] = r.to.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) { m = 1; y++; }
    if (out.length > 400) break;
  }
  return out;
}

// Ichki SQLite jurnali vaqtni UTC'da saqlaydi ("YYYY-MM-DD HH:MM:SS").
// Toshkent yarim tunlarini o'sha formatga o'giramiz, aks holda oraliq 5 soatga siljiydi.
// Umumiy javob uchun oraliqning ochiq ko'rinishi (api.mjs dagi pub bilan bir xil; /api/integrations shuni chaqiradi)
export const pub = (r) => ({ from: r.from, to: r.to, days: r.days, label: r.label, bucket: r.bucket,
  ...(r.rolling ? { rolling: true, fromISO: r.fromISO, toISO: r.toISO } : {}) });

export function sqlBounds(r) {
  const u = (iso) => new Date(iso).toISOString().slice(0, 19).replace("T", " ");
  return { fromSql: u(r.fromISO), toSql: u(r.toISO) };
}

// Oraliqdagi har bir kun: ["2026-09-01", ...]. Diagrammada bo'sh kunlar ham ko'rinsin.
export function eachDay(r) {
  const out = [];
  for (let t = utc(r.from); t <= utc(r.to); t += 864e5) out.push(iso(t));
  return out;
}

// Diagramma ustunlari. Uzoq oraliqda kunlik ustunlar o'qib bo'lmas darajada ingichka
// bo'lgani uchun haftalik guruhlanadi; `at(kun)` shu kun qaysi ustunga tushishini beradi.
export function buckets(r) {
  const days = eachDay(r);
  if (r.bucket === "day") return { keys: days, at: (d) => d, label: (d) => d };
  const startOf = (d) => {
    const w = new Date(utc(d));
    w.setUTCDate(w.getUTCDate() - ((w.getUTCDay() + 6) % 7));   // dushanba
    const s = iso(w.getTime());
    return s < r.from ? r.from : s;
  };
  const keys = [...new Set(days.map(startOf))];
  return { keys, at: startOf, label: (k) => k };
}
