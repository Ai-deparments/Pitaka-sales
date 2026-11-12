// Rahbar boti (2026-11-12) — Telegram'da egasining savollariga qisqa, aniq javob: «bu oy nechta lid keldi»,
// «nechtasi ketdi — qaysi operatordan, nega», «eng yaxshi / eng yomon sotuvchi», «operatorlar reytingi».
//
// Tartib: savol → niyat va davr (avval kalit so'zlar, tushunilmasa Gemini) → sonlar Bitrix'dan KOD bilan hisoblanadi →
// javob shablon bilan yoziladi. Model sonlarni yozmaydi — shuning uchun javobda to'qima raqam bo'lmaydi.
// Tillar: rus, o'zbek (lotin va kirill), ingliz — javob savol tilida. Kalit so'zlar asl matnda VA uning lotin
// transliteratsiyasida qidiriladi: «бугун» (o'zbekcha kirillda) ham «bugun» deb tushuniladi (12.11 xatosi: oy berilgan edi).
// Kirish: faqat RAHBAR_BOT_USERS dagi Telegram ID'lar (vergul bilan). Token: RAHBAR_BOT_TOKEN.
import * as rng from "./range.mjs";
import * as olchov from "./olchov.mjs";
import * as voronka from "./voronka.mjs";
import * as dir from "./directory.mjs";
import * as gemini from "./gemini.mjs";
import * as nazorat from "./nazorat.mjs";
import * as sifat from "./sifat.mjs";
import * as tovar from "./tovar.mjs";
import { swr } from "./cache.mjs";

const TG_API = (process.env.RAHBAR_TG_API || "https://api.telegram.org").replace(/\/+$/, "");
const TOP = 5;
const TTL = 5 * 60e3;

// ---------------------------------------------------------------- til va matn
const norm = (s) => String(s || "").toLowerCase().replace(/[ʻʼ’‘`']/g, "'").replace(/ё/g, "е");
const KL = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h" };
// Kirill → lotin, apostrof va x/kh → h: «Хусан», «Husan», «Xusan» — bir xil «husan»
export const lotin = (s) => norm(s).split("").map((c) => KL[c] ?? c).join("").replace(/o'|g'/g, (m) => m[0]).replace(/kh|x/g, "h").replace(/[^a-z0-9 ]/g, " ");
// Qidiruv uchun: asl matn + lotin shakli (kalit so'z ikkalasidan birida bo'lsa yetadi)
const ikki = (text) => `${norm(text)} | ${lotin(text)}`;

const UZ_SOZ = /\b(nechta|necha|nechpul|qancha|bugun|bugungi|kecha|hafta|haftada|oy|oyda|yil|kim|eng|lidlar|sotuv|sotdi|sotildi|ketdi|keldi|tushdi|yahshi|yaxshi|yomon|boldi|qanday|nima|nega|uchun|hato|pul|daromad|opkeldi|bitim|mijoz|qildi|ishladi|haqida)\b/;
const EN_SOZ = /\b(how|many|much|what|who|which|today|yesterday|week|month|leads?|sales?|sold|best|worst|lost|why|deals?|revenue|funnel|mistakes?|the|did|show|top)\b/;
export const til = (s) => {
  const L = lotin(s);
  if (/[ўқғҳ]/i.test(s) || UZ_SOZ.test(L)) return "uz";
  if (/[а-яё]/i.test(s)) return "ru";
  if (EN_SOZ.test(L)) return "en";
  return /[a-z]/i.test(s) ? "uz" : "ru";
};
const T = (t, ru, uz, en) => (t === "ru" ? ru : t === "en" ? en : uz);

// ---------------------------------------------------------------- davr
const OY_RU = ["январ", "феврал", "март", "апрел", "ма[йя]", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
const OY_LAT = ["yanvar|january", "fevral|february", "mart|march", "aprel|april", "\\bmay\\b", "iyun|june", "iyul|july", "avgust|august",
  "sentabr|sentyabr|september", "oktabr|oktyabr|october", "noyabr|november", "dekabr|december"];
const OY_NOM = { ru: ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"],
  uz: ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"],
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] };
const pad = (n) => String(n).padStart(2, "0");
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const haftaKuni = (ymd) => (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7;   // dushanba = 0

// today — "YYYY-MM-DD" (Toshkent). Qaytaradi: { kod, from, to }
export function davr(text, today = rng.today()) {
  const s = ikki(text), [y, m] = today.split("-").map(Number);
  const oy = (yy, mm) => ({ from: `${yy}-${pad(mm)}-01`, to: `${yy}-${pad(mm)}-${pad(lastDay(yy, mm))}` });
  const cap = (r) => ({ ...r, to: r.to > today ? today : r.to });
  if (/сегодня|\bbugun|\btoday/.test(s)) return { kod: "bugun", from: today, to: today };
  if (/вчера|\bkecha|yesterday/.test(s)) { const d = addDays(today, -1); return { kod: "kecha", from: d, to: d }; }
  if (/прошл\S* недел|o'?tgan hafta|utgan hafta|last week/.test(s)) { const mon = addDays(today, -haftaKuni(today)); return { kod: "otgan_hafta", from: addDays(mon, -7), to: addDays(mon, -1) }; }
  if (/недел|hafta|\bweek/.test(s)) return { kod: "hafta", from: addDays(today, -haftaKuni(today)), to: today };
  if (/прошл\S* месяц|o'?tgan oy|utgan oy|last month/.test(s)) { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return { kod: "otgan_oy", ...oy(py, pm) }; }
  const n = s.match(/(\d{1,3})\s*(дн|день|kun|days?)/);
  if (n) { const k = Math.min(366, Math.max(1, +n[1])); return { kod: `${k}_kun`, from: addDays(today, -(k - 1)), to: today }; }
  if (/\bгод|\byil\b|\byear/.test(s)) return { kod: "yil", from: `${y}-01-01`, to: today };
  for (let i = 0; i < 12; i++) {
    if (new RegExp(OY_RU[i]).test(s) || new RegExp(OY_LAT[i]).test(s)) {
      const yy = i + 1 > m ? y - 1 : y;
      return { kod: `oy_${yy}_${i + 1}`, ...cap(oy(yy, i + 1)) };
    }
  }
  return { kod: "bu_oy", ...cap(oy(y, m)) };
}
export function davrNomi(d, t) {
  const [fy, fm, fd] = d.from.split("-").map(Number), [, tm, td] = d.to.split("-").map(Number);
  const kk = `${fd}.${pad(fm)}–${td}.${pad(tm)}`;
  if (d.kod === "bugun") return T(t, "Сегодня", "Bugun", "Today");
  if (d.kod === "kecha") return T(t, "Вчера", "Kecha", "Yesterday");
  if (d.kod === "hafta") return T(t, `Эта неделя (${kk})`, `Bu hafta (${kk})`, `This week (${kk})`);
  if (d.kod === "otgan_hafta") return T(t, `Прошлая неделя (${kk})`, `O'tgan hafta (${kk})`, `Last week (${kk})`);
  if (d.kod === "yil") return T(t, `${fy} год (по ${td}.${pad(tm)})`, `${fy}-yil (${td}.${pad(tm)} gacha)`, `${fy} (to ${td}.${pad(tm)})`);
  if (/_kun$/.test(d.kod)) { const k = parseInt(d.kod, 10); return T(t, `Последние ${k} дн.`, `Oxirgi ${k} kun`, `Last ${k} days`); }
  const nom = OY_NOM[t === "ru" ? "ru" : t === "en" ? "en" : "uz"][fm - 1], N = nom[0].toUpperCase() + nom.slice(1);
  return td === lastDay(fy, fm) ? `${N} ${fy}` : `${N} (1–${td})`;
}

// ---------------------------------------------------------------- niyat
// lidlar · ketgan · sotuv · sotuv_reyting · reyting · xatolar · voronka · yozuv · yordam   (+ tartib: yaxshi | yomon, rol)
export function niyatKalit(text) {
  const s = ikki(text);
  if (/^\/(start|help)|помощ|что умеешь|yordam|nima qila|\bhelp\b|what can you/.test(s)) return { niyat: "yordam" };
  // Aniq yozuv: «лид 29957», «сделка #51700», «lead 29957», «bitim 51700» yoki savolda faqat raqam
  const yoz = s.match(/(лид\S*|lid\S*|lead\S*|сделк\S*|sdelk\S*|bitim\S*|deal\S*)\s*(?:№|#)?\s*(\d{3,9})/) || norm(text).match(/^\s*#?(\d{4,9})\s*\??$/);
  if (yoz) return yoz[2] ? { niyat: "yozuv", tur: /сделк|sdelk|bitim|deal/.test(yoz[1]) ? "deal" : "lead", id: yoz[2] } : { niyat: "yozuv", tur: "lead", id: yoz[1] };
  // Reklama xarajati, bitta sdelka narxi, kreativlar — panelda bu ma'lumot yo'q (Meta Ads ulanmagan): halol aytiladi
  if (/реклам|креатив|таргет|бюджет|стоимост\S* (сделк|лид)|цена (сделк|лид)|во сколько обход|reklama|kreativ|\btarget|byudjet|harajat|nechpulga (aylan|tush)|qanchaga (aylan|tush)|(sdelka|bitim|lid)\S* (narhi|narh)|tannarh|\bads?\b|creative|cost per|\bcpl\b|\bcac\b|\broas\b/.test(s))
    return { niyat: "reklama" };
  // Tovarlar: «какой товар продаётся лучше», «eng ko'p sotilgan tovar», «top products»
  if (/товар|продукт|чехл|чехол|модел|ассортимент|\btovar|mahsulot|chehol|chexol|\bmodel|products?\b|\bitems?\b|best.?sell|\bcases?\b/.test(s)) return { niyat: "tovar" };
  const yomon = /худш|плох|слаб|отста|yomon|eng past|kuchsiz|orqada|worst|\bbad\b|weak|lowest/.test(s);
  const yaxshi = /лучш|хорош|сильн|топ|лидир|yahshi|zo'?r|kuchli|\btop\b|reyting|рейтинг|\bbest|\bgood|strong/.test(s);
  const tartib = yomon ? "yomon" : "yaxshi";
  const rol = /менедж|продав|sotuvchi|menejer|manager|seller|salesperson/.test(s) ? "menejer" : /оператор|operator/.test(s) ? "operator" : null;
  if (/ошиб|качеств\S* (звонк|разговор)|разговар|балл|скрипт|\bhato|sifat|\bball|suhbat|skript|mistake|error|call quality|\bscript/.test(s))
    return { niyat: "xatolar", tartib: yaxshi && !yomon ? "yaxshi" : "yomon" };
  if (/воронк|оплат|конверс|дошл|voronka|to'?lov|tolov|konversiya|yetib|funnel|conversion|\bpaid|payment/.test(s)) return { niyat: "voronka" };
  if (/ушл|ушел|потер|отказ|отвал|слил|yo'?qot|yoqot|ketdi|ketgan|rad et|bekor|otkaz|\blost|refus|dropped/.test(s)) return { niyat: "ketgan" };
  if (/продаж|продал|сделк|выручк|доход|sotuv|sotdi|sotil|savdo|bitim|sdelk|daromad|dohod|\bpul\b|nechpul|tushum|opkel|olib kel|\bsales?\b|\bsold|revenue|income|\bdeals?\b/.test(s))
    return { niyat: yaxshi || yomon ? "sotuv_reyting" : "sotuv", tartib };
  if ((yaxshi || yomon) && (rol || /кто|\bkim\b|\bwho\b|сотрудн|hodim|employee/.test(s))) return { niyat: rol === "menejer" ? "sotuv_reyting" : "reyting", tartib, rol: rol || "operator" };
  if (/лид|заявк|обращен|\blid|\bleads?\b|ariza|murojaat|mijoz/.test(s)) return { niyat: "lidlar" };
  return null;
}
// «что с ним», «u haqida», «what about him» — oldingi suhbatdagi lid/bitim/xodimga ishora
export const ishora = (text) => /с ним|с ней|о н[её]м|у него|у неё|по нему|\bего\b|\bним\b|\bнему\b|этот лид|этим лидом|эта сделк|\bunga\b|\buni\b|\buning\b|u haqida|shu lid|bu lid|about (him|her|it)|\bhim\b|\bthis lead\b|\bthat one\b/.test(ikki(text));

// Bot uchun tezkor Gemini chaqiruvi: qo'ng'iroq tahlili navbatidan (so'rovlar orasida 10 s tanaffus — lib/gemini.mjs) TASHQARIDA.
// 12.11: ovozli xabarga javob 2 daqiqa kutildi — bot tahlil ishchisi bilan bitta navbatda turgan edi. Egasi jonli kutadi.
const BOT_MODELS = (process.env.RAHBAR_MODELS || "gemini-3.6-flash,gemini-3.5-flash,gemini-2.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite").split(",").map((s) => s.trim()).filter(Boolean);
async function gemTez(parts, { timeoutMs = 40000 } = {}) {
  if (!gemini.on()) throw new Error("GEMINI_API_KEY yo'q");
  const errs = [];
  for (const m of BOT_MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: "POST", signal: AbortSignal.timeout(timeoutMs),
        headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0, responseMimeType: "application/json" } }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { errs.push(`${m} ${r.status}`); continue; }
      const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
      return { parsed: JSON.parse(text), model: m };
    } catch (e) { errs.push(`${m} ${String(e.message || e).slice(0, 60)}`); }
  }
  throw new Error(`Gemini: ${errs.join(" | ")}`);
}

const NIYATLAR = ["tovar", "lidlar", "ketgan", "sotuv", "sotuv_reyting", "reyting", "xatolar", "voronka", "reklama", "yordam", "boshqa"];
async function niyatGemini(text) {
  if (!gemini.on()) return null;
  const prompt = `Classify a sales director's question to a CRM bot. The question may be in Russian, Uzbek (Latin or Cyrillic) or English.
Reply ONLY JSON: {"niyat": one of ${JSON.stringify(NIYATLAR)}, "tartib": "yaxshi"|"yomon", "rol": "operator"|"menejer"|null}.
lidlar = how many leads came; ketgan = lost/refused leads and why; sotuv = number/amount of sales or revenue; sotuv_reyting = best/worst salesperson by sales;
reyting = best/worst operator by work quality; xatolar = mistakes / quality of phone conversations by script criteria;
voronka = funnel: how many leads reached qualification, deal, payment; tovar = best-selling products / which product or model sells most; reklama = ad spend, cost per lead/deal, creatives, targeting; yordam = what can you do; boshqa = anything else. tartib "yomon" = asks for the worst.
Question: ${JSON.stringify(String(text).slice(0, 400))}`;
  try {
    const r = await gemTez([{ text: prompt }], { timeoutMs: 15000 });
    const j = r.parsed || {};
    if (!NIYATLAR.includes(j.niyat)) return null;
    if (j.niyat === "reklama" || j.niyat === "tovar") return { niyat: j.niyat };
    return { niyat: j.niyat, tartib: j.tartib === "yomon" ? "yomon" : "yaxshi", rol: j.rol === "menejer" ? "menejer" : "operator" };
  } catch { return null; }
}

// ---------------------------------------------------------------- ma'lumot (Bitrix)
const R_OF = (d) => rng.normalize({ from: d.from, to: d.to });

// Davrda yo'qotilgan lidlar (yopilgan sanasi, DATE_CLOSED) — operator va sabab bo'yicha; davrda bekor bo'lgan bitimlar — sabab bo'yicha
export const ketgan = (bx, d) => swr(`rahbar:ketgan:${d.from}:${d.to}`, TTL, async () => {
  const R = R_OF(d);
  const [L, D, E] = await Promise.all([
    bx.listAll("crm.lead.list", { filter: { STATUS_SEMANTIC_ID: "F", ">=DATE_CLOSED": R.fromISO, "<=DATE_CLOSED": R.toISO },
      select: ["ID", "STATUS_ID", "ASSIGNED_BY_ID", voronka.F.leadReason], maxItems: 20000 }),
    bx.listAll("crm.deal.list", { filter: { STAGE_SEMANTIC_ID: "F", ">=CLOSEDATE": R.fromISO, "<=CLOSEDATE": R.toISO },
      select: ["ID", "ASSIGNED_BY_ID", voronka.F.dealReason], maxItems: 20000 }),
    voronka.lugatlar(bx),
  ]);
  const { names } = await dir.names(bx, [...L.items, ...D.items].map((x) => x.ASSIGNED_BY_ID)).catch(() => ({ names: {} }));
  const leadSabab = (x) => E.leadReason[String(x[voronka.F.leadReason] || "")] || voronka.LEAD_LOST[x.STATUS_ID] || "sababsiz";
  const dealSabab = (x) => E.dealReason[String(x[voronka.F.dealReason] || "")] || "sababsiz";
  return { lid: guruhla(L.items, leadSabab, names), bitim: guruhla(D.items, dealSabab, names) };
});
// items → { soni, kim: [{ism, soni, sabab:[{n,c}]}], sabab: [{n,c}] } — eng ko'pi birinchi
export function guruhla(items, sababOf, names = {}) {
  const by = new Map(), jami = new Map();
  for (const x of items) {
    const id = String(x.ASSIGNED_BY_ID || "0"), s = sababOf(x);
    const o = by.get(id) || { id, ism: names[id] || (id === "0" ? "—" : `#${id}`), soni: 0, sabab: new Map() };
    o.soni++; o.sabab.set(s, (o.sabab.get(s) || 0) + 1); by.set(id, o);
    jami.set(s, (jami.get(s) || 0) + 1);
  }
  const srt = (mp) => [...mp.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => ({ n, c }));
  return { soni: items.length, kim: [...by.values()].sort((a, b) => b.soni - a.soni).map((o) => ({ ...o, sabab: srt(o.sabab) })), sabab: srt(jami) };
}
// swr: javob darhol keshdan, eskirgan bo'lsa fonda yangilanadi (jamoa sovuq holatda Bitrix'dan ~20 s o'qiladi)
export const lidlar = (bx, d) => swr(`rahbar:lid:${d.from}:${d.to}`, TTL, () => olchov.lid(bx, R_OF(d)));            // { yangi, uzatildi }
export const jamoa = (bx, db, d) => swr(`rahbar:jamoa:${d.from}:${d.to}`, TTL, () => olchov.jamoa(bx, db, R_OF(d)));  // operatorlar; menejerlar (yutildi, yutSumma)
export const tovarKesim = (bx, d) => swr(`rahbar:tovar:${d.from}:${d.to}`, TTL, () => tovar.top(bx, { range: R_OF(d), limit: 10 }));
export const sifatKesim = (bx, db, d) => swr(`rahbar:sifat:${d.from}:${d.to}`, TTL, () => nazorat.violations(bx, db, { range: R_OF(d) }));
export const voronkaKesim = (bx, db, d) => swr(`rahbar:voronka:${d.from}:${d.to}`, TTL, () => voronka.voronka(bx, db, { range: R_OF(d) }));

// Bitrix holat va bosqich nomlari (lid holati, bitim bosqichi — barcha yo'nalishlar)
const holatlar = (bx) => swr("rahbar:holatlar", 30 * 60e3, async () => {
  const { items } = await bx.listAll("crm.status.list", { select: ["ENTITY_ID", "STATUS_ID", "NAME"], maxItems: 5000 });
  const m = new Map(); for (const s of items) { m.set(`${s.ENTITY_ID}:${s.STATUS_ID}`, s.NAME); if (!m.has(s.STATUS_ID)) m.set(s.STATUS_ID, s.NAME); }
  return m;
});
// Bitta lid yoki bitim: holati, mas'ul, sana, manba, rad sababi, bog'liq bitim, AI xulosasi
export async function yozuv(bx, db, tur, id) {
  const [H, E] = await Promise.all([holatlar(bx), voronka.lugatlar(bx)]);
  if (tur === "deal") {
    const d = (await bx.call("crm.deal.get", { id })).result;
    if (!d) return null;
    const { names } = await dir.names(bx, [d.ASSIGNED_BY_ID]).catch(() => ({ names: {} }));
    return { tur, id: String(d.ID), nom: d.TITLE, holat: H.get(d.STAGE_ID) || d.STAGE_ID, masul: names[String(d.ASSIGNED_BY_ID)] || null,
      sana: d.DATE_CREATE, summa: Number(d.OPPORTUNITY) || 0, lead: d.LEAD_ID || null,
      // Rad sababi faqat yo'qotilgan bitimda: ochiq bitimda maydonda eski qiymat qolib ketgan bo'lishi mumkin
      sabab: d.STAGE_SEMANTIC_ID === "F" ? E.dealReason[String(d[voronka.F.dealReason] || "")] || null : null };
  }
  const x = (await bx.call("crm.lead.get", { id })).result;
  if (!x) return null;
  const [{ names }, deals] = await Promise.all([
    dir.names(bx, [x.ASSIGNED_BY_ID]).catch(() => ({ names: {} })),
    x.STATUS_ID === "CONVERTED" ? bx.call("crm.deal.list", { filter: { LEAD_ID: id }, select: ["ID", "STAGE_ID", "OPPORTUNITY", "CATEGORY_ID"] }).then((r) => r.result || []) : [],
  ]);
  const q = sifat.ofLeads(db, [String(x.ID)]).get(String(x.ID)) || null;
  return { tur: "lead", id: String(x.ID), nom: [x.NAME, x.LAST_NAME].filter(Boolean).join(" ") || x.TITLE, holat: H.get(`STATUS:${x.STATUS_ID}`) || H.get(x.STATUS_ID) || x.STATUS_ID,
    masul: names[String(x.ASSIGNED_BY_ID)] || null, sana: x.DATE_CREATE, manba: H.get(`SOURCE:${x.SOURCE_ID}`) || x.SOURCE_ID || null,
    sabab: x.STATUS_SEMANTIC_ID === "F" || voronka.LEAD_LOST[x.STATUS_ID] ? E.leadReason[String(x[voronka.F.leadReason] || "")] || null : null,
    bitim: deals.map((d) => ({ id: String(d.ID), holat: H.get(d.STAGE_ID) || d.STAGE_ID, summa: Number(d.OPPORTUNITY) || 0 })),
    ai: q ? { verdict: q.verdict, reason: q.reason } : null };
}

// ---------------------------------------------------------------- xodimni ism bo'yicha topish (kirill / lotin)
const SOZ_EMAS = new Set(["kak", "rabotal", "rabotaet", "skolko", "prodal", "kto", "luchshiy", "hudshiy", "operator", "menejer", "nedelyu", "mesyats",
  "etom", "proshlom", "segodnya", "vchera", "qanday", "ishladi", "nechta", "sotdi", "haftada", "bugun", "kecha", "oyda", "lidov", "lidlar",
  "sdelka", "sdelok", "boldi", "nechpul", "dohod", "opkeldi", "today", "worked", "week", "month", "sales", "leads", "what", "about", "how"]);
// people — [{id, ism}]; savoldagi so'z ism/familiya boshiga mos kelsa (kamida 4 harf) — o'sha xodim(lar)
export function xodimTop(text, people) {
  const q = lotin(text).split(/\s+/).filter((w) => w.length >= 4 && !SOZ_EMAS.has(w));
  if (!q.length) return [];
  const sc = people.map((p) => { const t = lotin(p.ism).split(/\s+/).filter(Boolean);
    return { p, n: q.filter((w) => t.some((x) => x.startsWith(w) || (w.length >= 5 && w.startsWith(x) && x.length >= 4))).length }; }).filter((o) => o.n);
  const max = Math.max(0, ...sc.map((o) => o.n));
  return sc.filter((o) => o.n === max).map((o) => o.p);
}
const xodimlar = (J) => { const m = new Map(); for (const o of [...(J.operatorlar || []), ...(J.menejerlar || [])]) if (!m.has(o.id)) m.set(o.id, { id: o.id, ism: o.ism }); return [...m.values()]; };

// ---------------------------------------------------------------- javob shablonlari (qisqa)
const fmt = (n) => Number(n || 0).toLocaleString("ru-RU").replace(/ /g, " ");
const mln = (n, t) => {
  const v = Number(n || 0);
  if (v >= 1e9) return `${(v / 1e9).toFixed(1).replace(".", ",")} ${T(t, "млрд", "mlrd", "bn")}`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(".", ",").replace(/,0$/, "")} ${T(t, "млн", "mln", "mln")}`;
  return `${fmt(v)} ${T(t, "сум", "so'm", "UZS")}`;
};
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const sabablar = (list, n = 2) => list.slice(0, n).map((s) => `${esc(s.n)} ${s.c}`).join(", ");

export const YORDAM = {
  ru: "Спросите коротко, например:\n• Сколько лидов пришло сегодня / в этом месяце?\n• Сколько ушло и почему?\n• Сколько продаж за неделю?\n• Кто лучший по продажам? / Кто худший?\n• Лучший оператор за прошлый месяц?\n• Как работал Азам на этой неделе?\n• У кого больше всего ошибок в разговоре?\n• Сколько дошло до оплаты?\n• Какие товары продаются лучше всего?\n• Лид 29957 / сделка 51700",
  uz: "Qisqa so'rang, masalan:\n• Bugun / bu oy nechta lid keldi?\n• Nechta ketdi va nega?\n• Bu hafta nechta sotuv?\n• Eng yaxshi sotuvchi kim? / Eng yomoni?\n• O'tgan oy eng yaxshi operator?\n• Azam bu hafta qanday ishladi?\n• Suhbatda kim eng ko'p xato qiladi?\n• Nechtasi to'lovgacha yetdi?\n• Qaysi tovar eng ko'p sotilyapti?\n• Lid 29957 / bitim 51700",
  en: "Ask briefly, for example:\n• How many leads came today / this month?\n• How many were lost and why?\n• How many sales this week?\n• Who is the best / worst seller?\n• Best operator last month?\n• How did Azam work this week?\n• Who makes the most mistakes on calls?\n• How many reached payment?\n• What are the best-selling products?\n• Lead 29957 / deal 51700",
};
export const REKLAMA_YOQ = {
  ru: "📣 Расходы на рекламу и креативы к панели не подключены (нужен доступ к Meta Ads), поэтому стоимость одной сделки и работу креативов посчитать не могу.\nМогу сейчас: сколько лидов, сколько дошло до сделки и оплаты, сколько продаж и на какую сумму.",
  uz: "📣 Reklama xarajati va kreativlar panelga ulanmagan (Meta Ads ruxsati kerak), shuning uchun bitta sdelka narxi va kreativlar samarasini hisoblay olmayman.\nHozir ayta olaman: nechta lid, nechtasi bitim va to'lovgacha yetdi, nechta sotuv va qancha summa.",
  en: "📣 Ad spend and creatives are not connected to the panel (Meta Ads access is needed), so I cannot compute cost per deal or creative performance.\nI can tell now: leads, how many reached a deal and payment, number and amount of sales.",
};
const QISQA_YORDAM = {
  ru: "Например: «сколько лидов сегодня», «сколько продаж за неделю», «кто лучший по продажам». Все примеры — /help",
  uz: "Masalan: «bugun nechta lid», «bu hafta nechta sotuv», «eng yaxshi sotuvchi kim». Hamma misollar — /help",
  en: "E.g. \"leads today\", \"sales this week\", \"best seller\". All examples — /help",
};
const TUSHUNMADIM = { ru: "Не понял вопрос.", uz: "Savolni tushunmadim.", en: "I didn't understand the question." };

export function javobLidlar(t, nom, x) {
  return `📥 <b>${nom}</b>\n${T(t, "Лидов пришло", "Kelgan lid", "New leads")}: <b>${fmt(x.yangi)}</b>\n${T(t, "Передано менеджерам", "Menejerga uzatildi", "Handed to managers")}: <b>${fmt(x.uzatildi)}</b>`;
}
export function javobKetgan(t, nom, k) {
  const L = k.lid, D = k.bitim;
  if (!L.soni && !D.soni) return `📤 <b>${nom}</b>\n${T(t, "Никто не ушёл.", "Hech kim ketmagan.", "Nobody was lost.")}`;
  const out = [`📤 <b>${nom}</b>\n${T(t, "Ушло лидов", "Ketgan lid", "Lost leads")}: <b>${fmt(L.soni)}</b>`];
  if (L.soni) {
    const kim = L.kim.slice(0, TOP).map((o) => `• ${esc(o.ism)} — <b>${fmt(o.soni)}</b> (${sabablar(o.sabab)})`).join("\n");
    const yana = L.kim.length > TOP ? `\n…${T(t, "ещё", "yana", "more")} ${L.kim.length - TOP}` : "";
    out.push(`${T(t, "По операторам:", "Operatorlar bo'yicha:", "By operator:")}\n${kim}${yana}`);
    out.push(`${T(t, "Главные причины", "Asosiy sabablar", "Main reasons")}: ${sabablar(L.sabab, 3)}`);
  }
  if (D.soni) out.push(`${T(t, "Сорвалось сделок", "Bekor bo'lgan bitim", "Lost deals")}: <b>${fmt(D.soni)}</b> (${sabablar(D.sabab, 3)})`);
  return out.join("\n\n");
}
export function javobSotuv(t, nom, J) {
  const M = J.menejerlar || [], n = M.reduce((a, o) => a + o.yutildi, 0), s = M.reduce((a, o) => a + o.yutSumma, 0);
  return `💰 <b>${nom}</b>\n${T(t, "Продаж (успешных сделок)", "Sotuv (yutilgan bitim)", "Sales (won deals)")}: <b>${fmt(n)}</b>\n${T(t, "На сумму", "Summa", "Amount")}: <b>${mln(s, t)}</b>`;
}
// Faqat davrda kamida bitta sotuvi bor xodimlar: ochiq bitimi bor, lekin sotmaydiganlar (G'amxo'rlik, NPS, Yollash
// yo'nalishlari) «eng yomon sotuvchi» bo'lib chiqmasin — o'lchangan 12.11: «yomon» ro'yxati 0 sotuvli 5 kishi edi.
export function javobSotuvReyting(t, nom, J, tartib) {
  const M = (J.menejerlar || []).filter((o) => o.yutildi > 0);
  if (!M.length) return `💰 <b>${nom}</b>\n${T(t, "Продаж нет.", "Sotuv yo'q.", "No sales.")}`;
  const L = [...M].sort((a, b) => b.yutildi - a.yutildi || b.yutSumma - a.yutSumma);
  const list = tartib === "yomon" ? L.slice(-TOP).reverse() : L.slice(0, TOP);
  const sar = tartib === "yomon" ? T(t, "меньше всего продаж", "eng kam sotuv", "fewest sales") : T(t, "лучшие по продажам", "eng ko'p sotuv", "top sellers");
  return `🏆 <b>${nom}</b> — ${sar}\n${list.map((o, i) => `${i + 1}. ${esc(o.ism)} — <b>${fmt(o.yutildi)}</b> ${T(t, "прод.", "ta", "sales")} · ${mln(o.yutSumma, t)}`).join("\n")}`;
}
// Operator: asosiy ko'rsatkich — menejerga uzatgan lidlar ulushi; kamida 10 ta lid olganlar solishtiriladi (kichik sonda nisbat aldaydi)
export function javobReyting(t, nom, J, tartib) {
  const O = (J.operatorlar || []).filter((o) => o.yangi >= 10);
  if (!O.length) return `👤 <b>${nom}</b>\n${T(t, "Мало данных по операторам.", "Operatorlar bo'yicha ma'lumot kam.", "Not enough operator data.")}`;
  const L = [...O].sort((a, b) => b.uzatildi / b.yangi - a.uzatildi / a.yangi || b.uzatildi - a.uzatildi);
  const list = tartib === "yomon" ? L.slice(-TOP).reverse() : L.slice(0, TOP);
  const sar = tartib === "yomon" ? T(t, "слабее всех операторы", "eng kuchsiz operatorlar", "weakest operators") : T(t, "лучшие операторы", "eng yaxshi operatorlar", "best operators");
  const row = (o, i) => `${i + 1}. ${esc(o.ism)} — ${T(t, "передал", "uzatdi", "handed")} <b>${fmt(o.uzatildi)}</b> ${T(t, "из", "/", "of")} ${fmt(o.yangi)}${o.ball != null ? ` · ${T(t, "балл", "ball", "score")} ${o.ball}` : ""}`;
  return `👤 <b>${nom}</b> — ${sar}\n${list.map(row).join("\n")}`;
}

// Mezon nomi qisqa: «E'tirozlar: qimmat, o'ylab ko'raman…» → «E'tirozlar»
export const qisqa = (label) => String(label || "").split(/[:,(]/)[0].trim() || String(label || "");
const kr = (c) => `${esc(qisqa(c.label))} ${c.avgPct}% (${c.of - c.failed}/${c.of})`;
const MIN_TAHLIL = 3;   // bundan kam tahlil qilingan qo'ng'iroqda mezon bo'yicha xulosa chiqarilmaydi
// Bitta xodim: lidlar, qo'ng'iroqlar, sotuv, AI ball, kuchli/zaif mezonlar
export function javobXodim(t, nom, ism, op, mg, v) {
  const out = [`👤 <b>${esc(ism)}</b> — ${nom}`];
  if (op && op.yangi) out.push(`${T(t, "Лидов", "Lid", "Leads")}: <b>${fmt(op.yangi)}</b>, ${T(t, "передал менеджерам", "menejerga uzatdi", "handed to managers")} <b>${fmt(op.uzatildi)}</b>`);
  const x = op || mg;
  const jp = x?.javobPct != null ? Math.round(x.javobPct) : null;
  if (x && x.qongiroq) out.push(`${T(t, "Звонков", "Qo'ng'iroq", "Calls")}: <b>${fmt(x.qongiroq)}</b>${jp != null ? `, ${T(t, "с ответом", "javob olgan", "answered")} ${jp}%` : ""}`);
  if (mg && mg.yutildi) out.push(`${T(t, "Продаж", "Sotuv", "Sales")}: <b>${fmt(mg.yutildi)}</b> · ${mln(mg.yutSumma, t)}; ${T(t, "открытых сделок", "ochiq bitim", "open deals")} ${fmt(mg.ochiq)}`);
  if (v && v.calls && v.calls < MIN_TAHLIL) {
    out.push(T(t, `AI-балл: ${v.avgScore ?? "—"}, но разобрано всего ${fmt(v.calls)} зв. — выводы рано.`,
      `AI ball: ${v.avgScore ?? "—"}, lekin atigi ${fmt(v.calls)} ta qo'ng'iroq tahlil qilingan — xulosa erta.`,
      `AI score: ${v.avgScore ?? "—"}, but only ${fmt(v.calls)} calls analysed — too early to judge.`));
  } else if (v && v.calls) {
    out.push(`${T(t, "AI-балл", "AI ball", "AI score")}: <b>${v.avgScore ?? "—"}</b> (${T(t, "разобрано звонков", "tahlil qilingan qo'ng'iroq", "calls analysed")}: ${fmt(v.calls)})`);
    const zaif = (v.criteria || []).filter((c) => c.avgPct < 60).sort((a, b) => a.avgPct - b.avgPct).slice(0, 3);
    const kuchli = (v.criteria || []).filter((c) => c.avgPct >= 75).sort((a, b) => b.avgPct - a.avgPct).slice(0, 2);
    if (zaif.length) out.push(`${T(t, "Слабо", "Zaif", "Weak")}: ${zaif.map(kr).join("; ")}`);
    if (kuchli.length) out.push(`${T(t, "Хорошо", "Yaxshi", "Strong")}: ${kuchli.map(kr).join("; ")}`);
  } else out.push(T(t, "Разобранных AI звонков за период нет.", "Davrda AI tahlil qilgan qo'ng'irog'i yo'q.", "No AI-analysed calls in this period."));
  return out.join("\n");
}
// Suhbat sifati: eng ko'p xato (eng past AI ball) yoki eng yaxshi; jamoaning eng zaif mezonlari
export function javobXatolar(t, nom, V, tartib) {
  const M = (V.managers || []).filter((m) => m.calls >= 3 && m.avgScore != null);
  if (!M.length) return `🎧 <b>${nom}</b>\n${T(t, "Мало разобранных звонков.", "Tahlil qilingan qo'ng'iroq kam.", "Too few analysed calls.")}`;
  const L = [...M].sort((a, b) => tartib === "yaxshi" ? b.avgScore - a.avgScore : a.avgScore - b.avgScore).slice(0, TOP);
  const sar = tartib === "yaxshi" ? T(t, "лучше всех говорят по скрипту", "skript bo'yicha eng yaxshi", "best on the script")
    : T(t, "больше всего ошибок в разговоре", "suhbatda eng ko'p xato", "most mistakes on calls");
  const row = (m, i) => { const w = m.weakest?.[0];
    return `${i + 1}. ${esc(m.name)} — ${T(t, "балл", "ball", "score")} <b>${m.avgScore}</b> (${fmt(m.calls)} ${T(t, "зв.", "ta", "calls")})${w ? ` · ${T(t, "слабо", "zaif", "weak")}: ${esc(qisqa(w.label))} ${w.avgPct}%` : ""}`; };
  const out = [`🎧 <b>${nom}</b> — ${sar}\n${L.map(row).join("\n")}`];
  const tz = (V.team?.criteria || []).slice().sort((a, b) => a.avgPct - b.avgPct).slice(0, 3);
  if (tz.length) out.push(`${T(t, "У всей команды слабее всего", "Jamoada eng zaif", "Team's weakest")}: ${tz.map((c) => `${esc(qisqa(c.label))} ${c.avgPct}%`).join("; ")}`);
  return out.join("\n\n");
}
// Eng ko'p sotilgan tovarlar: dona, summa, asosiy sotuvchi; qurilma modellari bo'yicha qisqa kesim
export function javobTovar(t, nom, d) {
  const L = (d.tovarlar || []).slice(0, TOP), J = d.jami || {};
  if (!L.length) return `📦 <b>${nom}</b>\n${T(t, "Проданных товаров нет.", "Sotilgan tovar yo'q.", "No products sold.")}`;
  const row = (x, i) => `${i + 1}. ${esc(x.nom.length > 70 ? x.nom.slice(0, 69) + "…" : x.nom)} — <b>${fmt(x.soni)}</b> ${T(t, "шт", "dona", "pcs")} · ${mln(x.summa, t)}${x.kim?.[0] ? ` · ${esc(x.kim[0].n)} ${x.kim[0].c}` : ""}`;
  const q = (d.qurilmalar || []).slice(0, 4).map((x) => `${esc(x.nom)} ${fmt(x.soni)}`).join(" · ");
  const out = [`📦 <b>${nom}</b> — ${T(t, "самые продаваемые товары", "eng ko'p sotilgan tovarlar", "best-selling products")}\n${L.map(row).join("\n")}`];
  if (q) out.push(`${T(t, "По моделям", "Modellar bo'yicha", "By model")}: ${q}`);
  out.push(T(t, `Всего ${fmt(J.dona)} шт на ${mln(J.summa, t)} в ${fmt(J.qatorli)} сделках.`, `Jami ${fmt(J.dona)} dona, ${mln(J.summa, t)}, ${fmt(J.qatorli)} ta bitimda.`, `Total ${fmt(J.dona)} pcs, ${mln(J.summa, t)}, in ${fmt(J.qatorli)} deals.`)
    + (J.qatorsiz ? " " + T(t, `Ещё ${fmt(J.qatorsiz)} сделок без товаров в CRM.`, `Yana ${fmt(J.qatorsiz)} ta bitimda tovar kiritilmagan.`, `${fmt(J.qatorsiz)} more deals have no products in CRM.`) : ""));
  return out.join("\n\n");
}
// Voronka: har bosqichga yetgan lidlar, «M / N» oldingi bosqichdan
export function javobVoronka(t, nom, v, J = null) {
  const B = v.bosqichlar || [];
  if (!B.length || !B[0].yetdi) return `🔻 <b>${nom}</b>\n${T(t, "Лидов нет.", "Lid yo'q.", "No leads.")}`;
  const rows = B.map((b, i) => `${i ? "↓ " : ""}${esc(b.nom)}: <b>${fmt(b.yetdi)}</b>${i ? ` / ${fmt(B[i - 1].yetdi)}` : ""}`);
  const k = v.kpi || {};
  const tail = T(t, `Потеряно ${fmt(k.yoqotilgan)}, ещё в работе ${fmt(k.ochiq)}.`, `Yo'qotilgan ${fmt(k.yoqotilgan)}, hali jarayonda ${fmt(k.ochiq)}.`, `Lost ${fmt(k.yoqotilgan)}, still open ${fmt(k.ochiq)}.`);
  // Voronka faqat SHU DAVRDA KELGAN lidlarni kuzatadi; sotuvlarning ko'pi lidga bog'lanmagan (B2C). Ikkala son yonma-yon
  // turmasa «4 to'lov» va «219 sotuv» bir-biriga zid ko'rinadi (egasi 12.11 shuni xato deb oldi).
  const M = J?.menejerlar || [], sn = M.reduce((a, o) => a + o.yutildi, 0), ss = M.reduce((a, o) => a + o.yutSumma, 0);
  const jami = sn ? `\n\n${T(t, "Всего продаж за период (все воронки, включая без лида)", "Davrdagi jami sotuv (barcha yo'nalishlar, lidsizlari ham)", "All sales in the period (all pipelines, incl. without a lead)")}: <b>${fmt(sn)}</b> · ${mln(ss, t)}` : "";
  return `🔻 <b>${nom}</b> — ${T(t, "лиды этого периода", "shu davr lidlari", "leads of this period")}\n${rows.join("\n")}\n\n${tail}${jami}`;
}
export function javobYozuv(t, z) {
  const sana = (s) => (s ? String(s).slice(0, 10) : "—");
  if (!z) return T(t, "Не найдено в Bitrix.", "Bitrix'da topilmadi.", "Not found in Bitrix.");
  const L = [`${z.tur === "deal" ? "💼" : "📄"} <b>${esc(z.nom || "#" + z.id)}</b> (${z.tur === "deal" ? T(t, "сделка", "bitim", "deal") : T(t, "лид", "lid", "lead")} #${z.id})`,
    `${T(t, "Статус", "Holat", "Status")}: <b>${esc(z.holat)}</b>`];
  if (z.masul) L.push(`${T(t, "Ответственный", "Mas'ul", "Owner")}: ${esc(z.masul)}`);
  L.push(`${T(t, "Создан", "Yaratilgan", "Created")}: ${sana(z.sana)}${z.manba ? ` · ${esc(z.manba)}` : ""}`);
  if (z.summa) L.push(`${T(t, "Сумма", "Summa", "Amount")}: ${mln(z.summa, t)}`);
  if (z.sabab) L.push(`${T(t, "Причина отказа", "Rad sababi", "Loss reason")}: ${esc(z.sabab)}`);
  for (const b of z.bitim || []) L.push(`${T(t, "Сделка", "Bitim", "Deal")} #${b.id}: ${esc(b.holat)}${b.summa ? ` · ${mln(b.summa, t)}` : ""}`);
  if (z.ai) L.push(`AI: ${z.ai.verdict === "sifatli" ? T(t, "качественный лид", "sifatli lid", "qualified lead") : esc(z.ai.verdict)}${z.ai.reason ? ` — ${esc(String(z.ai.reason).slice(0, 160))}` : ""}`);
  return L.join("\n");
}

// ---------------------------------------------------------------- bitta savolga javob
// kontekst — chat bo'yicha xotira ({ oxirgi: {tur:'yozuv'|'xodim', ...} }): «что с ним», «u haqida» shu yozuvga qaytadi
export async function javob(text, { bx, db, today = rng.today(), niyatFn = niyatGemini, kontekst = {} } = {}) {
  const t = til(text);
  let n = niyatKalit(text);
  if (n?.niyat === "yordam") return YORDAM[t];
  if (n?.niyat === "reklama") return REKLAMA_YOQ[t];
  if (!n && ishora(text) && kontekst.oxirgi?.tur === "yozuv") n = { niyat: "yozuv", ...kontekst.oxirgi.n };
  if (n?.niyat === "yozuv") {
    let z = null; try { z = await yozuv(bx, db, n.tur, n.id); } catch { z = null; }
    if (z) kontekst.oxirgi = { tur: "yozuv", n: { tur: n.tur, id: n.id } };
    return javobYozuv(t, z);
  }
  const d = davr(text, today), nom = esc(davrNomi(d, t));
  const xodimKarta = async (p) => {
    const [J, V] = await Promise.all([jamoa(bx, db, d), sifatKesim(bx, db, d).catch(() => null)]);
    const op = (J.operatorlar || []).find((o) => o.id === p.id), mg = (J.menejerlar || []).find((o) => o.id === p.id);
    const v = (V?.managers || []).find((m) => String(m.id) === String(p.id)) || null;
    kontekst.oxirgi = { tur: "xodim", p };
    return javobXodim(t, nom, p.ism, op, mg, v);
  };
  // Savolda xodim ismi bo'lsa («как работал Азам», «Azam qancha sotdi») — o'sha xodim kartasi
  if (!n || ["lidlar", "sotuv", "reyting", "sotuv_reyting", "xatolar"].includes(n.niyat)) {
    const odamlar = xodimlar(await jamoa(bx, db, davr("", today)).catch(() => ({})));
    const top = xodimTop(text, odamlar);
    if (top.length > 1 && top.length <= 6) return `${T(t, "Кого именно?", "Aynan kim?", "Who exactly?")}\n${top.map((p) => `• ${esc(p.ism)}`).join("\n")}`;
    if (top.length === 1) return xodimKarta(top[0]);
  }
  if (!n && ishora(text) && kontekst.oxirgi?.tur === "xodim") return xodimKarta(kontekst.oxirgi.p);
  if (!n) n = await niyatFn(text);
  if (!n || n.niyat === "boshqa") return `${TUSHUNMADIM[t]} ${QISQA_YORDAM[t]}`;
  if (n.niyat === "yordam") return YORDAM[t];
  if (n.niyat === "xatolar") return javobXatolar(t, nom, await sifatKesim(bx, db, d), n.tartib);
  if (n.niyat === "voronka") { const [v, Jv] = await Promise.all([voronkaKesim(bx, db, d), jamoa(bx, db, d).catch(() => null)]); return javobVoronka(t, nom, v, Jv); }
  if (n.niyat === "tovar") return javobTovar(t, nom, await tovarKesim(bx, d));
  if (n.niyat === "lidlar") return javobLidlar(t, nom, await lidlar(bx, d));
  if (n.niyat === "ketgan") return javobKetgan(t, nom, await ketgan(bx, d));
  const J = await jamoa(bx, db, d);
  if (n.niyat === "sotuv") return javobSotuv(t, nom, J);
  if (n.niyat === "sotuv_reyting") return javobSotuvReyting(t, nom, J, n.tartib);
  if (n.niyat === "reyting") return javobReyting(t, nom, J, n.tartib);
  return `${TUSHUNMADIM[t]} ${QISQA_YORDAM[t]}`;   // noma'lum niyat — taxminiy javob berilmaydi
}

// ---------------------------------------------------------------- ovozli xabar, rasm, video → savol (Gemini)
// Telegram xabaridan media turini va fayl ID'sini oladi. Bot API faqat 20 MB gacha faylni yuklab beradi.
export const MEDIA_MAX = 20 * 1024 * 1024;
export function mediaOf(m) {
  if (m.voice) return { tur: "ovoz", id: m.voice.file_id, mime: m.voice.mime_type || "audio/ogg", size: m.voice.file_size };
  if (m.audio) return { tur: "ovoz", id: m.audio.file_id, mime: m.audio.mime_type || "audio/mpeg", size: m.audio.file_size };
  if (m.video_note) return { tur: "video", id: m.video_note.file_id, mime: "video/mp4", size: m.video_note.file_size };
  if (m.video) return { tur: "video", id: m.video.file_id, mime: m.video.mime_type || "video/mp4", size: m.video.file_size };
  if (m.photo?.length) { const p = m.photo[m.photo.length - 1]; return { tur: "rasm", id: p.file_id, mime: "image/jpeg", size: p.file_size }; }
  if (m.document && /^(image|audio|video)\//.test(m.document.mime_type || "")) {
    const mt = m.document.mime_type; return { tur: mt.startsWith("image") ? "rasm" : mt.startsWith("audio") ? "ovoz" : "video", id: m.document.file_id, mime: mt, size: m.document.file_size };
  }
  return null;
}
// Media + izoh → egasining savoli (o'z tilida). Nutq bo'lsa — so'zma-so'z; rasmda — ko'rinib turgan narsadan savol (masalan lid raqami).
export async function mediaSavol(buf, md, izoh = "") {
  const prompt = `The sales director of Pitaka (phone-case shop, Uzbekistan) sent this ${md.tur === "rasm" ? "image" : md.tur === "video" ? "video" : "voice message"} to a CRM analytics bot${izoh ? ` with the caption: ${JSON.stringify(izoh.slice(0, 300))}` : ""}.
The bot only answers work questions: leads count, lost leads and reasons, sales, best/worst seller or operator, call-quality mistakes, funnel, a specific employee, a specific lead/deal by number.
Return ONLY JSON {"savollar": string[], "tavsif": string}.
- savollar: 0 to 3 separate short questions that were actually asked (a long voice message may contain several: e.g. funnel conversion, number of deals, cost per deal / ad creatives). Each is one short sentence in the language they used (Russian, Uzbek or English; Uzbek — in Latin script). If there is speech — transcribe the request faithfully, keep the time period they said (today, this week, this month…). If it is a screenshot — combine what is visible (e.g. a lead or deal number, an employee name) with the caption into a question, e.g. "лид 29957". Empty array if there is no work question at all. Never invent a question that was not asked. Questions about ad spend, cost per deal, creatives or targeting ARE work questions — include them.
- tavsif: one short sentence describing what the media contains, in Russian.`;
  const r = await gemTez([{ inline_data: { mime_type: md.mime, data: buf.toString("base64") } }, { text: prompt }], { timeoutMs: 45000 });
  const j = r.parsed || {};
  const L = (Array.isArray(j.savollar) ? j.savollar : j.savol ? [j.savol] : []).map((x) => String(x || "").trim().slice(0, 300)).filter(Boolean).slice(0, 3);
  return { savollar: L, savol: L[0] || null, tavsif: String(j.tavsif || "").slice(0, 200) };
}

// ---------------------------------------------------------------- Telegram (long polling, server ichida)
export const ruxsat = () => new Set(String(process.env.RAHBAR_BOT_USERS || "").split(/[\s,]+/).filter(Boolean));
async function tg(method, body, ms = 15000) {
  const r = await fetch(`${TG_API}/bot${process.env.RAHBAR_BOT_TOKEN}/${method}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}), signal: AbortSignal.timeout(ms) });
  const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}`, error_code: r.status }));
  if (!j.ok) throw Object.assign(new Error(j.description || "Telegram xatosi"), { code: j.error_code, retry: j.parameters?.retry_after });
  return j.result;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function ishgaTushir({ bx, db, log = console.log, audit = () => {} } = {}) {
  if (!process.env.RAHBAR_BOT_TOKEN) { log("RAHBAR_BOT_TOKEN yo'q — bot o'chiq"); return; }
  let offset = 0, pauza = 1000;
  const xotira = new Map();   // chat → kontekst (oxirgi lid/bitim/xodim)
  const yubor = (chat, text, reply) => tg("sendMessage", { chat_id: chat, text, parse_mode: "HTML", link_preview_options: { is_disabled: true },
    ...(reply ? { reply_parameters: { message_id: reply, allow_sending_without_reply: true } } : {}) });
  const yukla = async (fileId) => {
    const f = await tg("getFile", { file_id: fileId });
    const r = await fetch(`${TG_API}/file/bot${process.env.RAHBAR_BOT_TOKEN}/${f.file_path}`, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`fayl HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  };
  const handle = async (m) => {
    const uid = String(m.from?.id || ""), chat = m.chat?.id, izoh = String(m.text || m.caption || "").trim(), md = mediaOf(m);
    if (!chat || (!izoh && !md)) return;
    if (!ruxsat().has(uid)) {
      log(`ruxsatsiz: ${uid} @${m.from?.username || "-"}`); audit("rahbar.ruxsatsiz", `tg:${uid}`, m.from?.username || null);
      return tg("sendMessage", { chat_id: chat, text: T(til(izoh || "а"), `Нет доступа. Ваш ID: ${uid}`, `Ruxsat yo'q. ID: ${uid}`, `No access. Your ID: ${uid}`) });
    }
    tg("sendChatAction", { chat_id: chat, action: "typing" }).catch(() => {});
    let text = izoh, tepa = "", savollar = null;
    if (md) {
      // Ovoz / rasm / video: avval savolga aylantiramiz, keyin oddiy matnli savol kabi javob beramiz
      if (md.size && md.size > MEDIA_MAX) return yubor(chat, "Файл больше 20 МБ — Telegram не даёт боту его скачать. Пришлите короче или текстом.", m.message_id);
      // Darhol javob: egasi bot ishlayotganini ko'rsin (tahlil 5–40 s oladi); tayyor bo'lgach shu xabar o'chiriladi
      const kut = await yubor(chat, md.tur === "rasm" ? "🖼 Смотрю…" : md.tur === "video" ? "🎬 Смотрю видео…" : "🎙 Слушаю…", m.message_id).catch(() => null);
      const kutOch = () => { if (kut?.message_id) tg("deleteMessage", { chat_id: chat, message_id: kut.message_id }).catch(() => {}); };
      const yoz = setInterval(() => tg("sendChatAction", { chat_id: chat, action: "typing" }).catch(() => {}), 4500);
      let s;
      try { s = await mediaSavol(await yukla(md.id), md, izoh); }
      catch (e) { clearInterval(yoz); kutOch(); log(`media XATO: ${e.message}`); return yubor(chat, "Не удалось разобрать файл (Gemini занят или недоступен). Попробуйте через минуту или напишите текстом.", m.message_id); }
      clearInterval(yoz); kutOch();
      audit("rahbar.media", `tg:${uid}`, `${md.tur}: ${s.savollar.join(" | ") || s.tavsif}`.slice(0, 200));
      if (!s.savol) return yubor(chat, `${s.tavsif ? `${esc(s.tavsif)}\n\n` : ""}Вопроса по работе здесь не нашёл.\n\n${YORDAM.ru}`, m.message_id);
      text = s.savol; savollar = s.savollar; tepa = md.tur === "rasm" ? "🖼" : md.tur === "video" ? "🎬" : "🎙";
    }
    if (!xotira.has(chat)) xotira.set(chat, {});
    let out;
    try {
      if (savollar) {   // media: har savolga alohida qisqa javob, takror javoblar bir marta
        const parts = [], seen = new Set();
        for (const q of savollar) { const a = await javob(q, { bx, db, kontekst: xotira.get(chat) }); if (seen.has(a)) continue; seen.add(a); parts.push(`${tepa} <i>${esc(q)}</i>\n${a}`); }
        out = parts.join("\n\n— — —\n\n");
      } else out = await javob(text, { bx, db, kontekst: xotira.get(chat) });
    }
    catch (e) { log(`javob XATO: ${e.message}`); out = T(til(text), "Не удалось получить данные из Bitrix, попробуйте ещё раз.", "Bitrix'dan ma'lumot olinmadi, qayta urinib ko'ring.", "Could not read Bitrix, please try again."); }
    audit("rahbar.savol", `tg:${uid}`, text.slice(0, 200));
    await yubor(chat, out.slice(0, 4000), md ? m.message_id : null);
  };
  // Eng ko'p so'raladigan davrlar — joriy oy va bugun: fonda isitib turiladi, egasi kutmasin
  const isit = () => { for (const d of [davr("", rng.today()), davr("bugun", rng.today())])
    Promise.allSettled([lidlar(bx, d), ketgan(bx, d), jamoa(bx, db, d), sifatKesim(bx, db, d), voronkaKesim(bx, db, d), tovarKesim(bx, d)]); };
  isit(); setInterval(isit, TTL).unref?.();
  (async () => {
    try { const me = await tg("getMe"); log(`@${me.username} ulandi · ruxsat: ${[...ruxsat()].join(",") || "hech kim"}`); }
    catch (e) { log(`token qabul qilinmadi: ${e.message}`); return; }
    for (;;) {
      try {
        const ups = await tg("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] }, 40000);
        for (const up of ups) { offset = up.update_id + 1; if (up.message) handle(up.message).catch((e) => log(`xabar XATO: ${e.message}`)); }
        pauza = 1000;
      } catch (e) {
        if (e.code === 401 || e.code === 404) { log("token bekor — 5 daqiqa kutiladi"); await sleep(300e3); }
        else if (e.code === 409) { log("boshqa jarayon shu botni o'qiyapti (409) — 1 daqiqa"); await sleep(60e3); }
        else if (e.code === 429) await sleep(Math.max(5, e.retry || 30) * 1000);
        else { await sleep(pauza); pauza = Math.min(60e3, pauza * 2); }
      }
    }
  })();
}
