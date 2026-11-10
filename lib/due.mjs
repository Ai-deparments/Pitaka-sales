// Due-date parser for coach tasks: "ertaga soat 15:00" -> ISO in Tashkent time; vague text -> null.
// Moved out of the removed calltask.mjs (CRM writes are gone, the parser is still used by Murabbiy).
import { tashkentNow, ymd } from "./bitrix.mjs";

const WD = { dushanba:1, seshanba:2, chorshanba:3, payshanba:4, juma:5, shanba:6, yakshanba:7,
             "понедельник":1, "вторник":2, "среда":3, "среду":3, "четверг":4, "пятница":5, "пятницу":5,
             "суббота":6, "субботу":6, "воскресенье":7 };

// "ertaga soat 15:00" → 2026-09-10T15:00:00+05:00. Aniqlab bo'lmasa null.
export function parseDue(text, now = tashkentNow()) {
  const t = String(text || "").toLowerCase().replace(/[''`ʻʼ‘’]/g, "'");
  if (!t) return null;
  const d = new Date(now);
  let matched = false;

  // `\b` kirill bilan ISHLAMAYDI (JS'da \w faqat ASCII) — Unicode chegarasi shart.
  // Shu tuzoq bu loyihada ikkinchi marta uchradi: "завтра" topilmay qolgandi.
  const W = (...a) => new RegExp("(?<![\\p{L}\\p{N}_])(?:" + a.join("|") + ")(?![\\p{L}\\p{N}_])", "iu");
  let rest = t;                                     // sanani kesib tashlaymiz — vaqt qidiruvi unga tegmasin

  const dm = t.match(/(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{2,4}))?/);
  if (dm) {
    const y = dm[3] ? (dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]) : d.getFullYear();
    d.setFullYear(y, +dm[2] - 1, +dm[1]);
    rest = t.slice(0, dm.index) + " " + t.slice(dm.index + dm[0].length);
    matched = true;
  } else if (W("bugun", "сегодня").test(t)) { matched = true; }
  else if (W("ertaga", "завтра").test(t)) { d.setDate(d.getDate() + 1); matched = true; }
  else if (W("indinga", "послезавтра").test(t)) { d.setDate(d.getDate() + 2); matched = true; }
  else {
    for (const [w, n] of Object.entries(WD)) {
      if (!t.includes(w)) continue;
      const cur = d.getDay() === 0 ? 7 : d.getDay();
      d.setDate(d.getDate() + ((n - cur + 7) % 7 || 7));
      matched = true; break;
    }
  }
  if (!matched) return null;

  // Vaqt uchun faqat ":" — "12.09" sanasi 12:09 vaqti bo'lib o'qilgandi (sinovda topilgan).
  const tm = rest.match(/(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/);
  if (tm) d.setHours(+tm[1], +tm[2], 0, 0);
  else d.setHours(10, 0, 0, 0);                     // vaqt aytilmagan bo'lsa — ish kuni boshi
  const p = (n) => String(n).padStart(2, "0");
  return `${ymd(d)}T${p(d.getHours())}:${p(d.getMinutes())}:00+05:00`;
}
