// Tezkor javob — ombor va ta'minot: ko'p so'raladigan savollarga KOD bilan javob, model chaqirilmaydi.
// Raqamni Odoo hisoblaydi (ctx orqali, faqat o'qish; savolga 1–2 so'rov — MCP tezlik chegarasi).
// Javobda oyna va kesim vaqti bor. Savol tanilmasa yoki ma'lumot bo'sh — null: savol agentga ketadi.
// Kalit (2026-10-29): stock.quant, purchase.order(.line), product.*, mrp.* ochiq; joy/ombor/kategoriya
// nomlari domen va yozuv orqali keladi. Kirim/chiqim HUJJATLARI (stock.picking/move) yopiq — bu
// haqidagi savolga kod o'zi ochiq aytadi: javob bera olmayman (taxmin qilmaydi).

const LAT = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "j", з: "z", и: "i", й: "y", к: "k",
  л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ъ: "'", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  ў: "o'", қ: "q", ғ: "g'", ҳ: "h",
};
export function lotin(savol) {
  return String(savol || "").toLowerCase()
    .replace(/[ʻʼʹʽˈ‘’‛′`´＇]/g, "'")
    .replace(/[а-яёўқғҳ]/g, (c) => LAT[c] ?? c);
}

const UZ_KIRILL = /нечта|канча|қанча|кеча|бугун|омбор|харид|буюртма|қолди|колди|товар|махсулот|маҳсулот/;
const RU_BELGI = /сколько|остал|остат|склад|закуп|заказ|поставщ|вчера|сегодня|производств|сумм|в пути|товар|номенклат|категор|позици|какие|пришло/;
export function til(savol) {
  const s = String(savol || "").toLowerCase();
  if (!/[а-яё]/.test(s) || /[ўқғҳ]/.test(s) || UZ_KIRILL.test(s)) return "uz";
  return RU_BELGI.test(s) ? "ru" : "uz";
}

// Diqqat: lotin() da «ж» → «j», shuning uchun rus so'zlari regexlarda «j» bilan (podtverjd, snabjen).
const S = {
  bugun: /bugun|segodnya/,
  kecha: /kecha|vchera/,
  hafta: /hafta|nedel/,
  nkun: /(\d{1,3})\s*(kun|den|dney|dnya|dn)/,
  oy: /yanvar|fevral|\bmart|aprel|\bmay\b|\bmae\b|\bmaya\b|iyun|iyul|avgust|sentyabr|sentabr|oktyabr|oktabr|noyabr|dekabr/,
  ombor: /ombor|sklad|zaxira|zapas/,
  qoldiq: /qoldi|qoldiq|qancha bor|nechta bor|\bbormi\b|ostat|ostal|v nalichii|imeetsya|est li/,
  nol: /\bnol\b|nolga|tugagan|tugadi|\bminus|manfiy|zakonchil|nulev|otritsat|net v nalichii/,
  tur: /nechta xil|qancha xil|necha xil|nechta tur|pozitsi/,
  nomenkl: /nomenklatur|katalog|bazada nechta tovar|vsego tovarov|tovarov v baze|kartochk/,
  jami: /\bjami\b|umumiy|hammasi|vsego|edinits|birlik|\bdona\b|nechta mahsulot|qancha mahsulot/,
  omborlar: /kakie .*sklad|spisok sklad|qanday ombor|qaysi ombor|omborlar ro'yxat|omborlarimiz/,
  kategoriya: /kategori|toifa|guruh(i|lar)?\b/,
  xarid: /xarid|zakup|postavk|yetkazuvchi|yetkazib beruvchi|ta'minot|postavshch|snabjen/,
  buyurtma: /buyurtma|zakaz/,
  tasdiqsiz: /tasdiqlanmagan|qoralama|chernovik|ne ?podtverjd|ne ?utverjd/,
  tasdiq: /tasdiqlan|podtverjd|utverjd|oformlen|berildi|berilgan|sdelan/,
  yolda: /yo'lda|yolda|kelmagan|kelmadi|kutilmoqda|kutilayotgan|v puti|ne prishl|ne postupil|ojida/,
  summa: /summa|qancha pul|necha pul|summ|na skolko|stoimost|pulga|zakupili|xarid qildik|sotib old/,
  top: /eng ko'p|ko'proq|bolshe vsego|bolshe vseh|\btop\b|krupneysh|asosiy|zanimaet/,
  ishlab: /ishlab chiqarish|proizvodstv|\bmrp\b/,
  ochiq: /ochiq|otkryt|tugallanmagan|nezavershen|v rabote|jarayonda|aktivn/,
  hujjat: /kirim|chiqim|jo'nat|otgruz|prixod|prishlo|postupilo|peremesh|ko'chir|hujjat|dokument/,
  joy: /qayerda|gde lejit|gde naxod|joy(i|da)\b|lokats/,
  yozish: /\bspis|o'?chir\b|o'?chiri?b|hisobdan chiqar|buyurtma ber|o'?zgartir|qo'?sh\b|qo'?shib|to'?g'?rila|tuzat\b|kamaytir|ko'?paytir|oshir\b|\byoz\b|yozib qo'y|kirit\b|belgila\b|bekor qil|\bqil\b|qilib (qo'y|ber)|tasdiqla\b|yubor\b|jo'?nat\b|sozda|oformi|izmeni|ispravi|umenshi|uveli|dobav|udali|postav\b|postav(te|it)|zapishi|vnesi|otmeni|podtverdi|otprav|sdelay|perenesi|provedi/,
  // Tezkor javob faqat SAVOLGA: buyruq («…qil», «postav…», «spishi…») raqam bilan javob olmaydi (046).
  savol: /\?|nechta|qancha|necha|qaysi|qanday|bormi|\bnima\b|qachon|\bkim\b|skolko|kakie|kakaya|kakoy|kakix|kakov|\bchto\b|\bgde\b|kogda|est li|\bli\b/,
  shaxsiy: /\bmening\b|\bmenda\b|o'zimning|\bmoi\b|\bmoix\b|u menya|\bmoy\b/,
};

const OYLAR = [["yanvar"], ["fevral"], ["mart"], ["aprel"], ["\\bmay\\b", "\\bmae\\b", "\\bmaya\\b"], ["iyun"], ["iyul"],
  ["avgust"], ["sentyabr", "sentabr"], ["oktyabr", "oktabr"], ["noyabr"], ["dekabr"]];
const oyRaqami = (t) => OYLAR.findIndex((v) => v.some((w) => new RegExp(w).test(t))) + 1;

// Tovar nomini savoldan ajratish: xizmat so'zlarini olib tashlaymiz, o'zbekcha qo'shimchalarni kesamiz.
const STOP = new Set(`omborda ombor omborimizda skladda sklade sklad na v u nas est li qancha nechta necha
  qoldi qoldiq qoldig'i qolgan bor bormi tovar tovarlar tovardan mahsulot mahsulotlar hozir hozirda
  skolko ostalos ostalos' ostatok ostatki imeetsya v nalichii nalichii ta dona sht shtuk kerak
  bo'yicha po ochiq buyurtma buyurtmalar buyurtmasi zakaz zakazy zakazov kutilmoqda kutilayotgan
  yo'lda yolda yo'ldagi kelmagan to'liq qabul qilinmagan qaysi ham kim v puti ojidaetsya xarid xaridlar
  zakupka zakupki zakupku zakupok`.split(/\s+/));
const QOSHIMCHA = /(lardagi|lardan|larning|larni|lariga|larida|lari|dagi|dan|da|ning|ni|ga|lar)$/;
export function tovarNomi(t) {
  const soz = t.replace(/[?!.,:;«»"“”()]/g, " ").split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 5 ? w.replace(QOSHIMCHA, "") : w))
    .filter((w) => w.length >= 2 && !STOP.has(w));
  return soz.length ? soz : null;
}

export function aniqla(savol) {
  const asl = String(savol || "").trim();
  if (!asl || asl.length > 200) return null;
  const t = lotin(asl);
  const has = (k) => S[k].test(t);
  if (has("shaxsiy") || has("yozish")) return null;               // shaxsiy yoki yozish — faqat agent
  if (!has("savol")) return null;                                  // buyruq yoki gap — savol emas, agentga

  const nm = t.match(S.nkun);
  const oy = has("oy") ? oyRaqami(t) : 0;
  const oyna = has("bugun") ? { kun: "bugun" } : has("kecha") ? { kun: "kecha" }
    : oy ? { oy } : nm ? { n: Math.min(Number(nm[1]), 90) } : has("hafta") ? { n: 7 } : null;

  if (has("ishlab") && (has("ochiq") || /nechta|skolko|qancha/.test(t))) return { tur: "ishlab" };

  if (has("xarid") || has("buyurtma")) {
    // Hook sotuv agentida turadi: oddiy «buyurtma» u yerda MIJOZ buyurtmasi bo'lishi mumkin.
    // Xarid deb faqat aniq so'z bo'lsa (xarid/zakup/snabjen/yetkazuvchi) yoki «kelmagan» ma'nosida olamiz.
    if (!has("xarid") && !has("yolda")) return null;
    if (has("tasdiqsiz")) return { tur: "qoralama" };
    if (has("yolda")) {
      const nom = /zakazann|buyurtma qilingan/.test(t) ? null : tovarNomi(t);
      return nom ? { tur: "ochiq_buyurtma", nom } : { tur: "yolda" };
    }
    if (has("top") && has("xarid")) return { tur: "top", oyna: oyna || { n: 30 } };
    if (has("summa") && oyna) return { tur: "xarid_summa", oyna };
    if (has("ochiq")) return { tur: "ochiq_xarid" };
    if (oyna && (has("tasdiq") || /nechta|skolko|qancha/.test(t))) return { tur: "buyurtmalar", oyna };
    return null;
  }
  if (has("hujjat")) return { tur: "yopiq" };                     // kirim/chiqim hujjatlari — ochiq aytamiz
  if (has("joy")) return null;                                     // «qayerda» — agent (joy bo'yicha qidiradi)

  if (has("nomenkl")) return { tur: "nomenklatura" };
  if (has("omborlar")) return { tur: "omborlar" };
  if (has("kategoriya") && (has("top") || has("ombor"))) return { tur: "top_kategoriya" };
  if (has("tur") || (has("nol") && (has("qoldiq") || has("ombor") || /tovar/.test(t)))) return { tur: "pozitsiyalar" };
  if (has("ombor") && has("jami")) return { tur: "ombor_jami" };
  if (has("qoldiq") || (has("ombor") && /qancha|nechta|skolko/.test(t))) {
    const nom = tovarNomi(t);
    return nom ? { tur: "qoldiq", nom } : null;
  }
  return null;
}

// --- Vaqt (Toshkent, UTC+5) ---
const tk = (ms) => new Date(ms + 5 * 3600e3);
const ymd = (ms) => tk(ms).toISOString().slice(0, 10);
const hhmm = (ms) => tk(ms).toISOString().slice(11, 16);
export function oynaOraligi(o, now = Date.now()) {
  const kunOldin = (k) => ymd(now - k * 864e5);
  if (o.kun === "bugun") return { from: kunOldin(0), to: kunOldin(0), kun: "bugun" };
  if (o.kun === "kecha") return { from: kunOldin(1), to: kunOldin(1), kun: "kecha" };
  if (o.oy) {
    const bugun = kunOldin(0), y0 = Number(bugun.slice(0, 4)), m0 = Number(bugun.slice(5, 7));
    const y = o.oy > m0 ? y0 - 1 : y0, mm = String(o.oy).padStart(2, "0");
    const oxir = new Date(Date.UTC(y, o.oy, 0)).toISOString().slice(0, 10);
    return { from: `${y}-${mm}-01`, to: oxir < bugun ? oxir : bugun, oy: o.oy, joriy: oxir >= bugun };
  }
  return { from: kunOldin(o.n - 1), to: kunOldin(0), n: o.n };
}

const son = (n) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(n).replace(/ /g, " ");
const pul = (arr) => (arr || []).filter((x) => Number.isFinite(x.summa))
  .map((x) => `${son(x.summa)} ${x.valyuta || ""}`.trim()).join("; ");
const OY_UZ = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const OY_RU = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

function oynaMatn(R, L) {
  if (R.kun === "bugun") return L === "ru" ? `Сегодня (${R.from})` : `Bugun (${R.from})`;
  if (R.kun === "kecha") return L === "ru" ? `Вчера (${R.from})` : `Kecha (${R.from})`;
  if (R.oy) {
    const nom = L === "ru" ? OY_RU[R.oy - 1] : OY_UZ[R.oy - 1];
    const izoh = R.joriy ? (L === "ru" ? ", месяц ещё идёт" : ", oy hali tugamagan") : "";
    return `${nom[0].toUpperCase()}${nom.slice(1)} (${R.from} — ${R.to}${izoh})`;
  }
  return L === "ru" ? `Последние ${R.n} календарных дней (${R.from} — ${R.to})` : `Oxirgi ${R.n} kalendar kun (${R.from} — ${R.to})`;
}
const kesim = (L, now) => (L === "ru" ? ` Срез ${hhmm(now)}.` : ` Kesim ${hhmm(now)}.`);
const BIRLIK = { uz: " Diqqat: turli o'lchov birliklari (dona, metr, kg…) qo'shib hisoblangan.", ru: " Учтите: сложены разные единицы измерения (шт, м, кг…)." };
const MANBA = { uz: "\nManba: Odoo (tezkor javob).", ru: "\nИсточник: Odoo (быстрый ответ)." };

// ctx — o'qiydigan funksiyalar (ombor-ctx.mjs; har biri 1–2 so'rov). Shakllar ombor-ctx.mjs da.
export async function javob(savol, ctx, now = Date.now()) {
  const q = aniqla(savol);
  if (!q) return null;
  const L = til(savol), ru = L === "ru";
  let m = null;

  if (q.tur === "yopiq") {
    m = ru ? "Проведённые приходы, отгрузки и перемещения мне не видны: документы (stock.picking / stock.move) закрыты ключом доступа к Odoo, и в других доступных мне источниках проведённых приходов тоже нет — есть только ожидаемые. Ответить не могу и угадывать не буду. Открыть их может администратор Odoo, расширив доступ ключа."
      : "Bajarilgan kirim, chiqim va ko'chirishlar menga ko'rinmaydi: hujjatlar (stock.picking / stock.move) Odoo kalitida yopiq, boshqa ochiq manbalarda ham bajarilgan kirim yo'q — faqat kutilayotganlari bor. Javob bera olmayman va taxmin qilmayman. Ochish uchun Odoo administratori kalit doirasini kengaytirishi kerak.";
    return { tur: q.tur, text: m + MANBA[L] };
  }

  if (q.tur === "nomenklatura") {
    const r = await ctx.nomenklatura();
    if (!r || !Number.isFinite(r.jami)) return null;
    m = (ru ? `В номенклатуре ${son(r.jami)} позиций, из них складских (учитываемых на складе) — ${son(r.ombor)}.`
      : `Nomenklaturada ${son(r.jami)} ta tovar, shundan omborda hisobga olinadigani — ${son(r.ombor)} ta.`) + kesim(L, now);
  } else if (q.tur === "pozitsiyalar") {
    const r = await ctx.pozitsiyalar();
    if (!r || !Number.isFinite(r.bor)) return null;
    m = (ru ? `Позиций с остатком: ${son(r.bor)}, с нулевым остатком: ${son(r.nol)} (из ${son(r.jami)} складских).`
      : `Qoldig'i bor tovarlar: ${son(r.bor)} ta, qoldig'i nol: ${son(r.nol)} ta (omborda hisobga olinadigan ${son(r.jami)} tadan).`) + kesim(L, now);
  } else if (q.tur === "omborlar" || q.tur === "ombor_jami") {
    const r = await ctx.omborlar();
    if (!Array.isArray(r) || !r.length) return null;
    const t = lotin(savol);
    const tanlangan = r.filter((x) => t.includes(lotin(x.ombor)));
    const list = (tanlangan.length ? tanlangan : r).sort((a, b) => b.miqdor - a.miqdor);
    const q1 = (x) => (ru ? `«${x.ombor}» — ${son(x.miqdor)} ед. (${son(x.yozuv)} записей)` : `«${x.ombor}» — ${son(x.miqdor)} birlik (${son(x.yozuv)} ta yozuv)`);
    m = q.tur === "omborlar" && !tanlangan.length
      ? (ru ? `Склады: ${list.map(q1).join("; ")}.` : `Omborlar: ${list.map(q1).join("; ")}.`)
      : (ru ? `На складе ${list.map(q1).join("; ")}.` : `Omborda ${list.map(q1).join("; ")}.`);
    m += (ru ? " Показаны склады, где сейчас есть остаток; пустые склады этим доступом не видны. Только настоящие склады, без виртуальных мест (поставщики, клиенты, корректировки)."
      : " Qoldig'i bor omborlar ko'rsatildi; bo'sh omborlar bu kirish bilan ko'rinmaydi. Faqat haqiqiy omborlar, virtual joylarsiz (yetkazuvchi, mijoz, tuzatish).")
      + BIRLIK[L] + kesim(L, now);
  } else if (q.tur === "top_kategoriya") {
    const r = await ctx.topKategoriya();
    if (!Array.isArray(r) || !r.length) return null;
    const [a, ...rest] = [...r].sort((x, y) => y.miqdor - x.miqdor);
    const keyin = rest.slice(0, 2).map((x) => `«${x.kategoriya}» — ${son(x.miqdor)}`).join(", ");
    m = (ru ? `Больше всего на складе: «${a.kategoriya}» — ${son(a.miqdor)} ед.${keyin ? ` Далее: ${keyin}.` : ""}`
      : `Omborda eng ko'p: «${a.kategoriya}» — ${son(a.miqdor)} birlik.${keyin ? ` Keyingilar: ${keyin}.` : ""}`) + BIRLIK[L] + kesim(L, now);
  } else if (q.tur === "ochiq_xarid" || q.tur === "qoralama") {
    const h = await ctx.xaridHolat();
    if (!h || !Number.isFinite(h.purchase)) return null;
    const d = h.draft || 0, s = h.sent || 0, p = h.purchase || 0;
    if (q.tur === "qoralama") {
      m = (ru ? `Неподтверждённых заказов на закупку: ${son(d + s)} (черновики — ${son(d)}, отправлены поставщику — ${son(s)}).`
        : `Tasdiqlanmagan xarid buyurtmalari: ${son(d + s)} ta (qoralama — ${son(d)}, yetkazuvchiga yuborilgan — ${son(s)}).`) + kesim(L, now);
    } else {
      m = (ru ? `Заказы на закупку: подтверждены — ${son(p)}, черновики — ${son(d)}, отправлены — ${son(s)}, отменены — ${son(h.cancel || 0)}, закрыты (done) — ${son(h.done || 0)}.`
        : `Xarid buyurtmalari: tasdiqlangan — ${son(p)}, qoralama — ${son(d)}, yuborilgan — ${son(s)}, bekor — ${son(h.cancel || 0)}, yopilgan (done) — ${son(h.done || 0)}.`)
        + (!h.done ? (ru ? ` Заказы в системе не закрываются, поэтому «открытые» = подтверждённые + черновики + отправленные = ${son(p + d + s)}.`
          : ` Tizimda buyurtmalar yopilmaydi, shuning uchun «ochiq» = tasdiqlangan + qoralama + yuborilgan = ${son(p + d + s)} ta.`) : "")
        + kesim(L, now);
    }
  } else if (q.tur === "yolda") {
    const r = await ctx.yolda();
    if (!r || !Number.isFinite(r.buyurildi)) return null;
    const kelmagan = r.buyurildi - r.keldi;
    m = (ru ? `В подтверждённых заказах: заказано ${son(r.buyurildi)}, пришло ${son(r.keldi)} — не пришло ≈ ${son(kelmagan)} ед. По заказам: ничего не пришло — ${son(r.kutilmoqda)}, частично — ${son(r.qisman)}.`
      : `Tasdiqlangan buyurtmalarda: buyurtma qilingan ${son(r.buyurildi)}, kelgan ${son(r.keldi)} — kelmagan ≈ ${son(kelmagan)} birlik. Buyurtma bo'yicha: hech narsa kelmagan — ${son(r.kutilmoqda)} ta, qisman kelgan — ${son(r.qisman)} ta.`)
      + BIRLIK[L] + (ru ? " Часть приходов может быть не отмечена в Odoo." : " Kirimning bir qismi Odoo'da belgilanmagan bo'lishi mumkin.") + kesim(L, now);
  } else if (q.tur === "buyurtmalar" || q.tur === "xarid_summa") {
    const R = oynaOraligi(q.oyna, now), r = await ctx.buyurtmalar(R);
    if (!r || !Number.isFinite(r.soni)) return null;
    const s = pul(r.summa);
    const cc = Number.isFinite(r.kompaniya) ? (ru ? ` (в валюте компании ${son(r.kompaniya)})` : ` (kompaniya valyutasida ${son(r.kompaniya)})`) : "";
    m = ru ? `${oynaMatn(R, L)}: подтверждено заказов на закупку — ${son(r.soni)}${s ? `, сумма: ${s}${cc}` : ""}.`
      : `${oynaMatn(R, L)}: tasdiqlangan xarid buyurtmalari — ${son(r.soni)} ta${s ? `, summa: ${s}${cc}` : ""}.`;
    if (r.chiqarildi) m += ru ? ` ${son(r.chiqarildi)} заказ(а) с явно ошибочной суммой (больше 1 млрд) в сумму не включены.`
      : ` ${son(r.chiqarildi)} ta buyurtmaning summasi aniq xato (milliarddan katta) — summaga qo'shilmadi.`;
    m += kesim(L, now);
  } else if (q.tur === "top") {
    const R = oynaOraligi(q.oyna, now), r = await ctx.topYetkazuvchi(R);
    if (!Array.isArray(r) || !r.length) return null;
    const [a, ...rest] = r;
    const val = (x) => x.valyuta || (ru ? "в валюте компании" : "kompaniya valyutasida");
    const q1 = (x) => `${x.yetkazuvchi} — ${son(x.summa)} ${val(x)} (${son(x.soni)})`;
    const keyin = rest.slice(0, 3).map(q1).join("; ");
    m = ru ? `${oynaMatn(R, L)}, больше всего закупок: ${q1(a)}.${keyin ? ` Далее: ${keyin}.` : ""} В скобках — число заказов; заказы с ошибочной суммой не учтены.`
      : `${oynaMatn(R, L)} eng ko'p xarid: ${q1(a)}.${keyin ? ` Keyingilar: ${keyin}.` : ""} Qavsda — buyurtmalar soni; summasi xato buyurtmalar hisobga olinmagan.`;
    m += kesim(L, now);
  } else if (q.tur === "ishlab") {
    const h = (await ctx.ishlabChiqarish())?.holat;
    if (!h) return null;
    const ochiq = (h.draft || 0) + (h.confirmed || 0) + (h.progress || 0) + (h.to_close || 0);
    m = (ru ? `Открытых заказов на производство: ${son(ochiq)} (план — ${son(h.draft || 0)}, подтверждены — ${son(h.confirmed || 0)}, в работе — ${son(h.progress || 0)}, к закрытию — ${son(h.to_close || 0)}); выполнено — ${son(h.done || 0)}.`
      : `Ochiq ishlab chiqarish buyurtmalari: ${son(ochiq)} ta (reja — ${son(h.draft || 0)}, tasdiqlangan — ${son(h.confirmed || 0)}, jarayonda — ${son(h.progress || 0)}, yopishga — ${son(h.to_close || 0)}); bajarilgan — ${son(h.done || 0)} ta.`) + kesim(L, now);
  } else if (q.tur === "qoldiq") {
    const r = await ctx.qoldiq(q.nom);
    if (!r || !Array.isArray(r.rows) || !r.rows.length) return null;
    const rows = [...r.rows].sort((a, b) => b.qty - a.qty).slice(0, 5);
    const qator = (x) => `${x.product} — ${son(x.qty)} ${x.uom || ""}`.trim()
      + (Number.isFinite(x.available) && x.available !== x.qty ? (ru ? ` (свободно ${son(x.available)})` : ` (bo'sh ${son(x.available)})`) : "");
    const jami = r.jami_mos ?? rows.length;
    m = (rows.length === 1 && jami === 1)
      ? (ru ? `На складе: ${qator(rows[0])}.` : `Omborda: ${qator(rows[0])}.`)
      : (ru ? `Подходящие товары (${rows.length} из ${son(jami)}): ` : `Mos tovarlar (${son(jami)} tadan ${rows.length} tasi): `) + rows.map(qator).join("; ") + ".";
    m += kesim(L, now);
  } else if (q.tur === "ochiq_buyurtma") {
    const r = await ctx.ochiqBuyurtma(q.nom);
    if (!r || !r.jami_mos) return null;
    const nom = q.nom.join(" ");
    m = (!r.qator
      ? (ru ? `По «${nom}» незакрытых закупок нет.` : `«${nom}» bo'yicha to'liq kelmagan xarid yo'q.`)
      : (ru ? `По «${nom}» не получено полностью: строк ${son(r.qator)} (в ${son(r.buyurtma)} заказах), ожидается ${son(r.kutilmoqda)}.`
        : `«${nom}» bo'yicha to'liq kelmagan xarid: ${son(r.qator)} ta qator (${son(r.buyurtma)} ta buyurtma), kutilmoqda ${son(r.kutilmoqda)}.`)) + kesim(L, now);
  }
  return m ? { tur: q.tur, text: m + MANBA[L] } : null;
}
