// Tezkor javob — ko'p so'raladigan savollarga KOD bilan javob, model chaqirilmaydi.
// Raqamni panelning o'z funksiyalari hisoblaydi (ctx orqali beriladi), javobda oyna (qaysi kunlar)
// va kesim vaqti bor. Ma'lumot to'liq bo'lmasa (lid ro'yxati kesilgan, gigiena hamma bitimni
// ko'rmagan) yoki savol aniq tanilmasa — null: savol odatdagidek agentga ketadi.
import * as rng from "./range.mjs";

const LAT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "j", з: "z", и: "i", й: "y", к: "k",
  л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ъ: "'", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  ў: "o'", қ: "q", ғ: "g'", ҳ: "h",
};

// Savolni bitta alifboga keltiramiz: o'zbek kirill, rus va lotin bitta qoida bilan tutiladi.
export function lotin(savol) {
  return String(savol || "").toLowerCase()
    .replace(/[ʻʼ‘’`´]/g, "'")
    .replace(/[а-яёўқғҳ]/g, (c) => LAT[c] ?? c);
}

const RU_BELGI = /сколько|сегодня|вчера|сделк|звонк|лидов|лида|лиды|план|пропущ|аккаунт|учётн|учетн|откуда|источник|менеджер/;
const UZ_KIRILL = /нечта|канча|кеча|бугун|битим|лидлар|кунда|ойи|режа|мижоз|менежер|ҳисоб|хисоб/;
export function til(savol) {
  const s = String(savol || "").toLowerCase();
  if (!/[а-яё]/.test(s) || /[ўқғҳ]/.test(s) || UZ_KIRILL.test(s)) return "uz";
  return RU_BELGI.test(s) ? "ru" : "uz";
}

const S = {
  lid: /\blid/,
  bugun: /bugun|segodnya/,
  kecha: /kecha|vchera/,
  hafta: /hafta|nedel/,
  nkun: /(\d{1,3})\s*(kun|den|dney|dnya|dn)/,
  bitim: /bitim|sdel[ko]/,
  ochiq: /ochiq|otkryt/,
  qadam: /qadam|shag/,
  sana: /yopilish sana|sana(si)? (qo'yilmagan|yo'q)|dat[auy] zakryt|bez dat/,
  top: /eng ko'p|ko'proq|bolshe vsego|bolshe vseh|\btop\b/,
  kim: /menejer|menedzher|kimda|kimning|u kogo/,
  javobsiz: /javobsiz|bez otvet|ne otvet|neotvech|propushch/,
  soat24: /24|sutk/,
  reja: /\breja|\bplan\b|plana\b/,
  rejaNima: /sotuv|\boy|oylik|prodazh|mesyats|yanvar|fevral|mart|aprel|\bmay|iyun|iyul|avgust|sentabr|oktyabr|oktabr|noyabr|dekabr|oktyabr|oktyab/,
  qongiroq: /qo'ng'iroq|qongiroq|qo'ngiroq|zvon/,
  ulush: /ulush|foiz|%|dol[yie]|protsent|procent/,
  qilinmagan: /qilinmagan|qilmagan|qilinmadi|ne zvonil|bez zvonk|ne pozvon|nezvon/,
  hisob: /hisob(?!ot)|akkaunt|uchetn|foydalanuvchi|polzovatel/,
  panel: /panel/,
  manba: /manba|istochnik|qayerdan|otkuda|kanal/,
  instagram: /instagram/,
  // «mening bitimlarim», «menda nechta», «мои сделки» — savol o'zi haqida, bo'lim raqami emas
  shaxsiy: /\bmening\b|\bmenda\b|\bmenga\b|o'zimning|o'zimda|\bmoi\b|\bmoix\b|\bmoikh\b|u menya|\bmoyo\b|\bmoya\b/,
  // Maxfiylik yoki hukm talab qiladigan savol (guruh, telefon, ID…) — raqam javob emas, faqat agent (ijrochi, 018).
  // «telefon qo'ng'iroqlari» / «телефонных звонков» — bu qo'ng'iroq soni, maxfiylik emas (019).
  maxfiy: /guruh|group chat|v gruppe|gruppovoy|telefon(?![a-z']*\s*(qo'ng'iroq|qongiroq|qo'ngiroq|zvon))|nomer|crm ?id|\bid\s*(si|ni|sini)\b|shaxsiy ma'lumot|lichnye dann|pasport|e-?mail|pochta/,
};

// Ism yoki kompaniya bilan savol (masalan «Mirsharofda nechta ochiq bitim») — butun bo'lim
// raqami bilan javob berib bo'lmaydi. Jumla o'rtasida bosh harfli so'z bo'lsa — agentga
// (gap boshidagi so'z, «? Faqat» kabi, hisobga olinmaydi). Menejer ismlari javob() da tekshiriladi.
const nomBor = (savol) => {
  const t = String(savol || "").trim();
  return /[^\s.?!]\s+["«“'(]?[A-ZА-ЯЁЎҚҒҲ][a-zа-яёўқғҳ'ʻ’]+/.test(t) || /["«“][A-ZА-ЯЁЎҚҒҲ]/.test(t);
};

// Savolda menejer ismi bormi (overview.owners dan). «Mirsharofda …» — gap boshida ham tutiladi.
function menejerBor(t, ov) {
  for (const o of ov?.owners || []) {
    for (const w of lotin(o.ownerName || "").split(/[^a-z']+/)) if (w.length >= 4 && t.includes(w)) return true;
  }
  return false;
}

export function aniqla(savol) {
  const asl = String(savol || "").trim();
  if (!asl || asl.length > 160) return null;
  const t = lotin(asl);
  const has = (k) => S[k].test(t);
  const kun = has("bugun") ? "bugun" : has("kecha") ? "kecha" : null;
  const nm = t.match(S.nkun);
  const nkun = nm ? Math.min(Number(nm[1]), 90) : has("hafta") ? 7 : null;

  if (has("instagram")) return null;                      // oxirgi lid qachon — CRM qidiruvi, agentga
  if (has("shaxsiy")) return null;                        // «mening …» — shaxsiy ko'rinish, agentga
  if (has("maxfiy")) return null;                         // maxfiylik/hukm savoli — faqat agent
  if (has("lid") && has("qongiroq") && has("qilinmagan")) return { tur: "qongiroqsiz", kun: kun || "kecha" };
  if (has("lid") && has("qongiroq")) return null;         // «lidlarga qo'ng'iroq» — boshqa savol, agentga
  if (has("qongiroq") && has("javobsiz") && has("ulush")) return { tur: "javobsiz_ulush", kun: kun || "kecha" };
  if (has("qongiroq") && kun) return { tur: "qongiroq", kun };
  if (has("lid") && has("javobsiz") && has("soat24")) return { tur: "javobsiz24" };
  if (has("bitim")) {
    if (nomBor(asl)) return null;
    if (has("sana")) return { tur: "sanasiz" };
    if (has("qadam")) return { tur: "qadamsiz" };
    if (has("top") && has("kim")) return { tur: "top" };
    if (has("ochiq") && !has("kim")) return { tur: "ochiq" };
    return null;
  }
  if (has("reja") && has("rejaNima")) return { tur: "reja" };
  if (has("hisob") && has("panel")) return { tur: "hisoblar" };
  if (has("lid") && has("manba") && kun) return { tur: "manba", kun };
  if (has("lid") && (has("kim") || has("top"))) return null; // «eng ko'p lid olgan menejer kim» — son emas, agentga
  if (has("lid") && nkun && !kun) return { tur: "lid_n", n: nkun };
  if (has("lid") && kun && !nomBor(asl)) return { tur: "lid_kun", kun };
  return null;
}

// --- Vaqt ---
const tkNow = (now) => new Date(now + 5 * 3600e3);                // Toshkent devor soati
export const hhmm = (now) => tkNow(now).toISOString().slice(11, 16);
const soat = (now) => tkNow(now).getUTCHours();
export function kunOraligi(kun) {
  const d = kun === "bugun" ? rng.today() : rng.normalize(2).from;   // normalize(2) = kecha..bugun
  return rng.normalize({ from: d, to: d });
}

export const son = (n) => new Intl.NumberFormat("ru-RU").format(n).replace(/\u00a0/g, " ");
// Rus tilida son bilan so'z: 1 лид, 3 лида, 5 лидов (11–14 — «лидов»).
const ruSon = (n, bir, ikki, kop) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return `${son(n)} ${a > 10 && a < 15 ? kop : b === 1 ? bir : b >= 2 && b <= 4 ? ikki : kop}`;
};

export function dum(lang, kun, now) {
  const k = hhmm(now);
  if (kun === "bugun") return lang === "ru"
    ? ` Срез ${k}, день ещё не закончился.`
    : ` Kesim ${k}, kun hali tugamagan.`;
  if (kun === "kecha" && soat(now) < 12) return lang === "ru"
    ? ` Срез ${k}, предварительно: вчерашний день ещё дозаполняется, после 12:00 число может вырасти.`
    : ` Kesim ${k}, dastlabki: kecha hali to'ldirilmoqda, 12:00 dan keyin raqam o'sishi mumkin.`;
  return lang === "ru" ? ` Срез ${k}.` : ` Kesim ${k}.`;
}
const KUN = { uz: { bugun: "Bugun", kecha: "Kecha" }, ru: { bugun: "Сегодня", kecha: "Вчера" } };
const MANBA = { uz: "\nManba: panel (tezkor javob).", ru: "\nИсточник: панель (быстрый ответ)." };

// Gigiena hamma ochiq bitimni ko'rganmi? Ko'rmagan bo'lsa (lim 1000) — bu bo'lim raqamlarini bermaymiz.
export const toliq = (ov) => ov && Number.isFinite(ov.openAll) && (ov.active + ov.archive) >= ov.openAll;
const checkSoni = (ov, id) => (ov.checks || []).find((c) => c.id === id)?.count;

// ctx — panel funksiyalari (server.mjs yoki tezkor-cli.mjs beradi):
//   leads(R, limit) → {total, rows}   overview() → hygiene.overview
//   javobsiz24() → son                plan() → {plan, updatedAt}
//   calls(R) → calls.calls             users() → son
// Gigiena eng og'ir chaqiruv — faqat bitim savollarida (ularga baribir kerak).
const BITIM_TUR = ["ochiq", "qadamsiz", "sanasiz", "top"];
const overviewOf = (ctx) => Promise.resolve().then(() => ctx.overview()).catch(() => null);

export async function javob(savol, ctx, now = Date.now()) {
  const q = aniqla(savol);
  if (!q) return null;
  // Menejer ismi shu yerda tekshiriladi; boshqa savollarda ismni nomBor() (gap o'rtasidagi bosh harf) ushlaydi.
  const ov = BITIM_TUR.includes(q.tur) ? await overviewOf(ctx) : null;
  if (ov && menejerBor(lotin(savol), ov)) return null;  // bitta odam haqida — bo'lim raqami emas
  return hisobla(q, ctx, til(savol), now, ov ?? null);
}

// Savol turi tayyor bo'lsa (Telegram tugmasi, lib/menyu.mjs) — matn tahlilisiz, shu hisob-kitob.
// ov berilmasa (undefined) — bitim turlarida o'zi oladi.
export async function hisobla(q, ctx, L = "uz", now = Date.now(), ov = undefined) {
  if (ov === undefined) ov = BITIM_TUR.includes(q.tur) ? await overviewOf(ctx) : null;
  const ru = L === "ru";
  let matn = null;

  if (q.tur === "lid_kun") {
    const R = kunOraligi(q.kun), r = await ctx.leads(R, 1);
    if (!Number.isFinite(r?.total)) return null;
    matn = ru ? `${KUN.ru[q.kun]} (${R.from}): ${ruSon(r.total, "лид", "лида", "лидов")}.` : `${KUN.uz[q.kun]} (${R.from}): ${son(r.total)} ta lid.`;
    matn += dum(L, q.kun, now);
  } else if (q.tur === "lid_n") {
    const R = rng.normalize(q.n), r = await ctx.leads(R, 1);
    if (!Number.isFinite(r?.total)) return null;
    matn = ru
      ? `Последние ${q.n} календарных дней (${R.from} — ${R.to}): ${ruSon(r.total, "лид", "лида", "лидов")}. Срез ${hhmm(now)}, сегодняшний день ещё не закончился.`
      : `Oxirgi ${q.n} kalendar kun (${R.from} — ${R.to}): ${son(r.total)} ta lid. Kesim ${hhmm(now)}, bugungi kun hali tugamagan.`;
  } else if (q.tur === "manba") {
    const R = kunOraligi(q.kun), r = await ctx.leads(R, 500);
    if (!Number.isFinite(r?.total) || !Array.isArray(r.rows) || r.rows.length < r.total) return null;
    const m = new Map();
    for (const x of r.rows) m.set(x.source || "—", (m.get(x.source || "—") || 0) + 1);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} — ${v}`).join(", ");
    matn = ru
      ? `${KUN.ru[q.kun]} (${R.from}), источники лидов: ${top} (всего ${son(r.total)}).`
      : `${KUN.uz[q.kun]} (${R.from}) lidlar manbasi: ${top} (jami ${son(r.total)}).`;
    matn += dum(L, q.kun, now);
  } else if (q.tur === "ochiq") {
    if (!Number.isFinite(ov?.openAll)) return null;
    matn = ru ? `Сейчас открытых сделок (все воронки): ${son(ov.openAll)}. Срез ${hhmm(now)}.`
      : `Hozir ochiq bitimlar (barcha voronkalar): ${son(ov.openAll)} ta. Kesim ${hhmm(now)}.`;
  } else if (q.tur === "qadamsiz" || q.tur === "sanasiz") {
    if (!toliq(ov)) return null;
    const c = checkSoni(ov, q.tur === "qadamsiz" ? "qadam" : "sana");
    if (!Number.isFinite(c)) return null;
    const arx = ov.archive ? (ru ? ` (${son(ov.archive)} сделок без изменений больше года не учтены)` : ` (1 yildan ortiq o'zgarmagan ${son(ov.archive)} tasi hisobga olinmagan)`) : "";
    const nima = q.tur === "qadamsiz" ? (ru ? "Без следующего шага" : "Keyingi qadam belgilanmagan") : (ru ? "Без даты закрытия" : "Yopilish sanasi qo'yilmagan");
    matn = ru ? `${nima}: ${son(c)} из ${son(ov.active)} активных открытых сделок${arx}. Срез ${hhmm(now)}.`
      : `${nima}: ${son(c)} ta — ${son(ov.active)} ta faol ochiq bitimdan${arx}. Kesim ${hhmm(now)}.`;
  } else if (q.tur === "top") {
    if (!toliq(ov) || !ov.owners?.length) return null;
    const [a, ...rest] = ov.owners;
    const nom = (o) => o.ownerName || `#${o.owner}`;
    const keyin = rest.slice(0, 3).map((o) => `${nom(o)} — ${son(o.total)}`).join(", ");
    matn = ru ? `Больше всего открытых сделок: ${nom(a)} — ${son(a.total)}.${keyin ? ` Далее: ${keyin}.` : ""} Срез ${hhmm(now)}.`
      : `Eng ko'p ochiq bitim: ${nom(a)} — ${son(a.total)} ta.${keyin ? ` Keyingilar: ${keyin}.` : ""} Kesim ${hhmm(now)}.`;
  } else if (q.tur === "javobsiz24") {
    const n = await ctx.javobsiz24();
    if (!Number.isFinite(n)) return null;
    matn = ru ? `Лидов без ответа больше 24 часов: ${son(n)} (среди пришедших за последние 30×24 часа). Срез ${hhmm(now)}.`
      : `24 soatdan oshgan javobsiz lidlar: ${son(n)} ta (oxirgi 30×24 soat ichida kelganlar orasida). Kesim ${hhmm(now)}.`;
  } else if (q.tur === "reja") {
    const p = await ctx.plan();
    if (!p) return null;
    matn = !p.plan
      ? (ru ? "План продаж на текущий месяц в панель не внесён." : "Joriy oy uchun sotuv rejasi panelga kiritilmagan.")
      : (ru ? `План продаж на текущий месяц: ${son(p.plan)} сум${p.updatedAt ? ` (внесён ${p.updatedAt})` : ""}.`
        : `Joriy oy sotuv rejasi: ${son(p.plan)} so'm${p.updatedAt ? ` (kiritilgan: ${p.updatedAt})` : ""}.`);
  } else if (q.tur === "qongiroq" || q.tur === "javobsiz_ulush" || q.tur === "qongiroqsiz") {
    const R = kunOraligi(q.kun), c = await ctx.calls(R);
    const t = c?.totals, rs = c?.response;
    if (!t || !Number.isFinite(t.calls)) return null;
    if (q.tur === "qongiroq") {
      matn = ru ? `${KUN.ru[q.kun]} (${R.from}): ${ruSon(t.calls, "звонок", "звонка", "звонков")} — входящих ${son(t.in)}, исходящих ${son(t.out)}.`
        : `${KUN.uz[q.kun]} (${R.from}): ${son(t.calls)} ta qo'ng'iroq — ${son(t.in)} kiruvchi, ${son(t.out)} chiquvchi.`;
    } else if (q.tur === "javobsiz_ulush") {
      matn = ru ? `${KUN.ru[q.kun]} (${R.from}) неотвеченных звонков: ${t.missedRate}% (${son(t.missed)} из ${son(t.calls)}).`
        : `${KUN.uz[q.kun]} (${R.from}) javobsiz qo'ng'iroqlar: ${t.missedRate}% (${son(t.missed)} / ${son(t.calls)}).`;
    } else {
      if (!rs || !Number.isFinite(rs.leads)) return null;
      matn = ru
        ? `${KUN.ru[q.kun]} (${R.from}) пришло лидов: ${son(rs.leads)}. Мы позвонили: ${son(rs.called)}, пришли входящим звонком: ${son(rs.inbound)}, без звонка: ${son(rs.notCalled)}.`
        : `${KUN.uz[q.kun]} (${R.from}) kelgan ${son(rs.leads)} ta liddan: ${son(rs.called)} tasiga biz qo'ng'iroq qilganmiz, ${son(rs.inbound)} tasi kiruvchi qo'ng'iroqdan tushgan, ${son(rs.notCalled)} tasiga qo'ng'iroq qilinmagan.`;
    }
    matn += dum(L, q.kun, now);
  } else if (q.tur === "hisoblar") {
    const n = await ctx.users();
    if (!Number.isFinite(n)) return null;
    matn = ru ? `Учётных записей в панели: ${son(n)}.` : `Panelda ${son(n)} ta foydalanuvchi hisobi bor.`;
  }

  return matn ? { tur: q.tur, text: matn + MANBA[L] } : null;
}
