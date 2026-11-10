// TZ §4.D — kritik so'zlar lug'ati. Administrator tahrirlashi mumkin (call_dict jadvali),
// bu yerdagilar — zavod sozlamasi (default).
// Har bir ibora: nima uchun xavfli (reason) va operator nima qilishi kerak (tip).
// Uzbek + rus + lotin/kirill aralash yoziladi — portalda uch xil ham uchraydi.

export const COLORS = {
  red:    { id: "red",    label: "Kritik",   css: "risk",    weight: 3 },
  yellow: { id: "yellow", label: "Ikkilanish", css: "warning", weight: 2 },
  green:  { id: "green",  label: "Ijobiy",   css: "success", weight: -2 },
  blue:   { id: "blue",   label: "Fakt",     css: "action",  weight: 0 },
};

// term — qidiriladigan ibora (kichik harfda, qism-so'z sifatida qidiriladi)
// kind — mantiq uchun (rang TZ §4.D bo'yicha o'zgarmaydi):
//   pain      — mijozning MUAMMOSI (jarima, tekshiruv). Bu bizga sotuv imkoniyati,
//               kayfiyatni tushirmaydi, lekin SHOSHILINCHLIKNI oshiradi.
//   objection — bizga qarshi e'tiroz (qimmat, o'ylab ko'raman, raqobatchi).
//   risk      — munosabatga real tahdid (sud, shikoyat, bekor qilish, ishonchsizlik).
//   buy       — sotib olish signali.
const D = (color, kind, term, reason, tip) => ({ color, kind, term, reason, tip });
export const KINDS = {
  pain:      { label: "Mijoz muammosi", hint: "sotuv imkoniyati" },
  objection: { label: "E'tiroz",        hint: "javob talab qiladi" },
  risk:      { label: "Tahdid",         hint: "bitim yo'qolishi mumkin" },
  buy:       { label: "Sotib olish signali", hint: "darhol mahkamlang" },
};

export const DEFAULT_DICT = [
  // ---------- QIZIL: real xavf ----------
  D("red", "risk", "sud", "Mijoz sud jarayonini tilga oldi — huquqiy xavf va shoshilinch holat", "Darhol rahbarga eskalatsiya qiling, va'da bermang, huquq bo'limi bilan tekshiring"),
  D("red", "risk", "суд", "Mijoz sud jarayonini tilga oldi — huquqiy xavf", "Rahbarga eskalatsiya, yozma javob tayyorlang"),
  D("red", "pain", "jarima", "Mijoz jarima yoki sanksiyani tilga oldi — shoshilinch muammo", "Jarima sababi va summasini aniqlang, SUN-HIGHTECH qanday yordam berishini aniq ayting"),
  D("red", "pain", "штраф", "Jarima masalasi — shoshilinch muammo", "Summa va muddatni aniqlang, yechim taklif qiling"),
  D("red", "pain", "tekshiruv", "Tekshiruv yoki nazorat tilga olindi — yuqori shoshilinchlik", "Tekshiruv sanasini aniqlang va shu kungacha ulguradigan reja bering"),
  D("red", "pain", "проверк", "Tekshiruv — yuqori shoshilinchlik", "Sana va hujjat ro'yxatini aniqlang"),
  D("red", "pain", "qarzdorlik", "Qarzdorlik — to'lov qobiliyati va bloklanish xavfi", "Qarz summasi va muddatini aniqlang, to'lov grafigi taklif qiling"),
  D("red", "pain", "задолженност", "Qarzdorlik — to'lov xavfi", "Summani aniqlang, to'lov grafigi bering"),
  D("red", "pain", "blok", "Hisob/faoliyat bloklangan — biznes to'xtagan", "Bu eng shoshilinch holat, bugunoq yechim qadamini bering"),
  D("red", "pain", "заблокир", "Bloklanish — biznes to'xtagan", "Bugunoq harakat rejasini bering"),
  D("red", "risk", "shikoyat", "Mijoz shikoyat qilmoqda — norozilik darajasi yuqori", "Uzr so'rang, faktni yozib oling, muddat bilan yechim va'da qiling"),
  D("red", "risk", "жалоб", "Shikoyat — norozilik", "Faktni yozing, muddatli yechim bering"),
  D("red", "risk", "bekor qil", "Xizmatdan voz kechish signali — bitim yo'qolish arafasida", "Sababni ochiq so'rang, rahbar darajasida saqlash taklifi bering"),
  D("red", "risk", "расторг", "Shartnomani bekor qilish — bitim yo'qoladi", "Sababni aniqlang, rahbarga eskalatsiya"),
  D("red", "risk", "откаж", "Voz kechish signali", "Sababni ochiq so'rang"),
  D("red", "objection", "boshqa kompaniya", "Raqobatchi tilga olindi — mijoz taqqoslamoqda", "Raqobatchi kimligini va nimasi yoqqanini aniqlang, farqni faktda ko'rsating"),
  D("red", "objection", "другая компания", "Raqobatchi tilga olindi", "Farqni aniq faktda ko'rsating"),
  D("red", "objection", "конкурент", "Raqobatchi tilga olindi", "Taqqoslash mezonini aniqlang"),
  D("red", "objection", "qimmat", "Narx e'tirozi — qiymat tushuntirilmagan bo'lishi mumkin", "Narxni emas, natijani taqqoslang: elektr to'lovidagi tejam va stansiya necha yilda o'zini oqlashini raqamda ko'rsating"),
  D("red", "objection", "дорого", "Narx e'tirozi", "Qiymatni raqamda ko'rsating"),
  D("red", "risk", "ishonmayman", "Ishonch yo'qolgan — sotuv to'xtaydi", "Dalil bering: shartnoma, kafolat, mavjud mijoz namunasi"),
  D("red", "risk", "не доверя", "Ishonchsizlik", "Dalil va kafolat bering"),
  D("red", "pain", "muddat o'tgan", "Muddat o'tib ketgan — jarima/sanksiya xavfi", "Qancha o'tganini aniqlang va oqibatni raqamda ayting"),
  D("red", "pain", "просрочен", "Muddat o'tgan", "Oqibatni raqamda ayting"),
  D("red", "risk", "aldadi", "Mijoz aldanganini aytmoqda — ishonch inqirozi", "Faktni yozib oling, rahbarga eskalatsiya qiling"),
  D("red", "risk", "обман", "Aldanish da'vosi — ishonch inqirozi", "Faktni yozing, eskalatsiya qiling"),
  D("red", "risk", "pul qaytar", "Pulni qaytarish talabi", "Talab sababini yozing, rahbar tasdig'isiz va'da bermang"),
  D("red", "risk", "вернуть деньги", "Pul qaytarish talabi", "Rahbarsiz va'da bermang"),

  // ---------- SARIQ: ikkilanish ----------
  D("yellow", "objection", "o'ylab ko'ra", "Kechiktirish — qaror qabul qilinmagan", "Aniq nima noaniqligini so'rang va keyingi aloqa sanasini kelishing"),
  D("yellow", "objection", "уylab", "Kechiktirish signali", "Noaniq joyni aniqlang"),
  D("yellow", "objection", "подума", "Kechiktirish — qaror qabul qilinmagan", "Aniq savolni oching, sana kelishing"),
  D("yellow", "objection", "keyinroq", "Kechiktirish — muddat aniq emas", "Aniq sana va vaqt taklif qiling"),
  D("yellow", "objection", "позже", "Kechiktirish", "Aniq sana taklif qiling"),
  D("yellow", "objection", "rahbar bilan", "Qaror qabul qiluvchi boshqa odam — QQQ aniqlanmagan", "Rahbar bilan uchrashuv yoki uch tomonlama qo'ng'iroq taklif qiling"),
  D("yellow", "objection", "с руководител", "Qaror qabul qiluvchi boshqa odam", "Uchrashuv taklif qiling"),
  D("yellow", "objection", "директор", "Qaror direktorga bog'liq", "Direktor bilan aloqa kelishing"),
  D("yellow", "objection", "narx yubor", "Faqat narx so'ralmoqda — ehtiyoj ochilmagan", "Narxdan oldin ehtiyojni oching, aks holda taqqoslash mashinasiga aylanadi"),
  D("yellow", "objection", "прайс", "Faqat narx so'raldi", "Ehtiyojni oching"),
  D("yellow", "objection", "пришлите цен", "Faqat narx so'raldi", "Ehtiyojni oching"),
  D("yellow", "objection", "vaqt yo'q", "Suhbat uzilmoqda — diqqat yo'q", "Qulay vaqtni so'rab, qayta qo'ng'iroqni kalendarga yozing"),
  D("yellow", "objection", "некогда", "Suhbat uzilmoqda", "Qayta qo'ng'iroq vaqtini kelishing"),
  D("yellow", "objection", "solishtir", "Mijoz taqqoslamoqda — raqobat bosqichi", "Taqqoslash mezonini so'rang va shu mezonda ustunlikni ko'rsating"),
  D("yellow", "objection", "сравн", "Taqqoslash bosqichi", "Mezonni aniqlang"),
  D("yellow", "objection", "budjet yo'q", "Budjet cheklovi", "Bosqichma-bosqich yoki minimal paket taklif qiling"),
  D("yellow", "objection", "нет бюджет", "Budjet cheklovi", "Bosqichli paket taklif qiling"),

  // ---------- YASHIL: ijobiy ----------
  D("green", "buy", "boshlaymiz", "Sotib olishga tayyorlik signali", "Darhol keyingi qadamni sana bilan mahkamlang"),
  D("green", "buy", "начнём", "Tayyorlik signali", "Keyingi qadamni sana bilan yozing"),
  D("green", "buy", "начинаем", "Tayyorlik signali", "Sana bilan mahkamlang"),
  D("green", "buy", "shartnoma", "Shartnoma bosqichiga o'tish", "Hujjatni bugun yuboring va qabul qilinganini tasdiqlang"),
  D("green", "buy", "договор", "Shartnoma bosqichi", "Hujjatni bugun yuboring"),
  D("green", "buy", "hisob yubor", "To'lov bosqichi", "Hisobni bugun yuboring, to'lov muddatini kelishing"),
  D("green", "buy", "выставьте счёт", "To'lov bosqichi", "Hisobni bugun yuboring"),
  D("green", "buy", "счет", "Hisob-faktura tilga olindi", "To'lov muddatini aniqlang"),
  D("green", "buy", "uchrashuv", "Uchrashuv kelishildi", "Sana, vaqt va joyni kalendarga yozing"),
  D("green", "buy", "встреч", "Uchrashuv kelishildi", "Kalendarga yozing"),
  D("green", "buy", "roziman", "Rozilik bildirildi", "Rozilikni yozma tasdiqlang"),
  D("green", "buy", "согласен", "Rozilik bildirildi", "Yozma tasdiqlang"),
  D("green", "buy", "to'lov qil", "To'lov niyati", "To'lov sanasini aniqlang"),
  D("green", "buy", "оплат", "To'lov mavzusi", "Sana va summani aniqlang"),
  D("green", "buy", "hujjat yubor", "Hujjat almashinuvi boshlandi", "Ro'yxatni aniq yozing va muddat qo'ying"),
  D("green", "buy", "отправлю документ", "Hujjat almashinuvi", "Muddat qo'ying"),
];

// ---------------------------------------------------------------------------
// MUHIM: JavaScript'da `\b` faqat ASCII bo'yicha ishlaydi — `/\bчто\b/` kirill
// matnda HECH QACHON topilmaydi. Portalda ruscha suhbat ko'p, shuning uchun
// barcha naqsh Unicode chegarasi bilan quriladi. (Sinovdan o'tkazilgan.)
const B = "(?<![\\p{L}\\p{N}_])";        // so'z boshi
const E = "(?![\\p{L}\\p{N}_])";         // so'z oxiri
const W = (...alts) => new RegExp(B + "(?:" + alts.join("|") + ")" + E, "iu");
const Wg = (...alts) => new RegExp(B + "(?:" + alts.join("|") + ")" + E, "giu");

// TZ §4.D "Ko'k" — bu so'z emas, naqsh: sana, summa, telefon, email, hujjat nomi, vaqt.
export const FACT_PATTERNS = [
  { kind: "date",  label: "Sana", re: new RegExp(
      B + "(?:\\d{1,2}[.\\/-]\\d{1,2}(?:[.\\/-]\\d{2,4})?|dushanba|seshanba|chorshanba|payshanba|juma|shanba|yakshanba|ertaga|bugun|indinga|понедельник|вторник|сред[ау]|четверг|пятниц[ауы]|суббот[ауы]|воскресень[ея]|завтра|сегодня|послезавтра)" + E, "giu") },
  { kind: "time",  label: "Vaqt", re: new RegExp(
      B + "(?:[01]?\\d|2[0-3])[:.][0-5]\\d" + E + "|" + B + "\\d{1,2}\\s*(?:soat|час[аов]*)" + E, "giu") },
  { kind: "money", label: "Summa", re: new RegExp(
      B + "\\d[\\d\\s.,]{2,}\\s*(?:so'm|som|sum|сум|сўм|usd|доллар\\p{L}*|dollar|mln|млн|ming|тыс\\p{L}*)" + E
      + "|" + B + "(?:bir|ikki|uch|to'rt|besh|olti|yetti|sakkiz|to'qqiz|o'n|yigirma|o'ttiz|qirq|ellik|yuz|один|дв[ае]|три|четыре|пят\\p{L}*|шест\\p{L}*|сем\\p{L}*|восем\\p{L}*|девят\\p{L}*|десят\\p{L}*|сто)\\s+(?:million\\p{L}*|milliard\\p{L}*|ming|миллион\\p{L}*|тысяч\\p{L}*|млрд)" + E, "giu") },
  { kind: "phone", label: "Telefon", re: /(?:\+?998[\s-]?)?\b\d{2}[\s)-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g },
  { kind: "email", label: "Email", re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/gi },
  { kind: "doc",   label: "Hujjat", re: Wg("shartnoma\\p{L}*", "hisob(?:-faktura)?", "akt", "договор\\p{L}*", "счёт", "счет", "invoice", "акт", "коммерческое предложение", "tijorat taklif\\p{L}*") },
];

// Ochiq savol boshlovchilari — §F.3 "to'g'ri savollar" mezoni uchun
export const OPEN_Q = W("nima\\p{L}*", "nega", "qanday", "qanaqa", "qaysi", "qachon", "qancha", "kim", "qayer\\p{L}*", "nechta", "sabab\\p{L}*",
                        "что", "почему", "зачем", "как", "как[оа]\\p{L}*", "какие", "когда", "сколько", "кто", "где");
export const GREET = W("assalom\\p{L}*", "salom", "alaykum", "xayrli", "здравствуйте", "добрый\\s+(?:день|вечер)", "доброе утро", "приветствую", "алло", "здрасьте");
export const INTRO = W("sun.?high.?tech", "san.?xaytek", "сан.?хайтек", "get.?green", "гет.?грин", "mening ismim", "меня зовут", "kompaniyasidan", "компании", "beruvchi", "bezovta qil\\p{L}*", "звоню из", "по поводу");
export const CLOSE = W("xayr", "salomat bo'ling", "ko'rishguncha", "rahmat", "yaxshi kun", "до свидания", "всего доброго", "спасибо", "хорошего дня", "созвонимся", "на связи");
export const VALUE = W("tejay\\p{L}*", "tejash", "foyda\\p{L}*", "natija\\p{L}*", "kafolat\\p{L}*", "tajriba\\p{L}*", "mutaxassis\\p{L}*", "jarimadan", "xatosiz", "avtomat\\p{L}*", "hisobot\\p{L}*", "optimallash\\p{L}*", "himoya\\p{L}*", "nazorat qil\\p{L}*",
                      "экономи\\p{L}*", "выгод\\p{L}*", "результат\\p{L}*", "гаранти\\p{L}*", "опыт", "специалист\\p{L}*", "автоматиз\\p{L}*", "отчёт\\p{L}*", "отчет\\p{L}*", "оптимиз\\p{L}*", "защит\\p{L}*");
export const NEXT_STEP = W("yuboraman", "jo'nataman", "qo'ng'iroq qilaman", "uchrashamiz", "kelishamiz", "tayyorlayman", "yozaman", "bog'lanaman",
                           "отправлю", "перезвоню", "позвоню", "встретимся", "подготовлю", "вышлю", "скину", "напишу", "свяжусь");
// §4.C shoshilinchlik — muddat va tezkorlik signallari
export const URGENCY = W("shoshilinch\\p{L}*", "tezda", "zudlik\\p{L}*", "bugunoq", "ertagacha", "muddat\\p{L}*", "keyingi oy\\p{L}*", "shu hafta",
                         "срочн\\p{L}*", "быстр\\p{L}*", "до конца", "дедлайн\\p{L}*", "на следующей неделе", "в этом месяце");
