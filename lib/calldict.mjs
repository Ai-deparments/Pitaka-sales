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

// Pitaka (premium Aramid chexollar, rasmiy diler). E'tirozlar va javoblar ProAudit «oltin ssenariylari»dan olingan:
// Pre Sale (1-qo'ng'iroq), Qayta (iliq mijoz), After Sale, Seminar feedback — data/pitaka-scenarios.json.
export const DEFAULT_DICT = [
  // ---------- QIZIL: real xavf ----------
  D("red", "risk", "nusxa", "Mijoz original emas deb shubhalanmoqda", "Rasmiy diler ekanimizni, kafolat va 10 kunlik qaytarishni ayting"),
  D("red", "risk", "подделк", "Original emas degan shubha", "Rasmiy diler va kafolatni ayting"),
  D("red", "risk", "ariza qoldirmaganman", "Mijoz ariza qoldirmaganini aytmoqda — lid sifati shubhali", "Ssenariy: «Instagram'da beixtiyor bosgandirsiz» deb yumshating va telefon modelini so'rang"),
  D("red", "risk", "заявку не оставлял", "Ariza qoldirmagan — lid sifati shubhali", "Yumshoq tushuntiring va modelni so'rang"),
  D("red", "objection", "arzon", "Mijoz bozordagi arzonroq variantni tilga oldi", "Ssenariy: arzonlari nusxa, bizda rasmiy kafolat va 10 kunda qaytarish bor"),
  D("red", "objection", "дешевле", "Arzonroq variant tilga olindi", "Original va kafolat farqini ayting"),
  D("red", "objection", "boshqa joydan oldim", "Mijoz raqobatchidan sotib olgan", "Ssenariy: qaysi model va qanchaga olganini so'rang — keyingi taklif uchun"),
  D("yellow", "objection", "maslahatlash", "Qaror boshqa odam bilan — kechiktirish", "Asosiy afzalliklarni yozib yoki video-obzor yuborishni taklif qiling"),
  D("yellow", "objection", "pulim yo'q", "Hozir pul yo'q — kechiktirish", "Ssenariy: modelni bron qilib qo'yishni va qulay sanada qayta bog'lanishni taklif qiling"),
  D("yellow", "objection", "нет денег", "Pul yo'q — kechiktirish", "Bron va qayta qo'ng'iroq sanasini kelishing"),
  D("yellow", "objection", "vaqtim yo'q", "Suhbat uzilmoqda", "Ssenariy: modelni so'rab qoling va qulay vaqtni kelishing"),
  D("yellow", "objection", "bandman", "Suhbat uzilmoqda", "Qulay vaqtni so'rab, qayta qo'ng'iroqni yozib qo'ying"),
  D("yellow", "objection", "kerak emas", "Rad etish signali", "Ssenariy: hozirgi chexolidan mamnunmi deb so'rang va Aramid farqini ayting"),
  D("yellow", "objection", "не нужно", "Rad etish signali", "Hozirgi chexol haqida so'rang"),
  D("yellow", "objection", "chegirma", "Chegirma so'ralmoqda", "Ssenariy: narx qat'iy — chegirma o'rniga qiymat (sovg'a, bepul yetkazish) taklif qiling"),
  D("yellow", "objection", "скидк", "Chegirma so'ralmoqda", "Narx o'rniga qiymat taklif qiling"),
  D("yellow", "objection", "eslolmadim", "Mijoz murojaatini eslamaydi", "Kontekstni eslating: Instagram, qaysi telefon uchun qiziqqan"),
  D("yellow", "pain", "qirilib", "Mahsulotda nuqson — kafolat holati", "Ssenariy (After Sale): rasmini Telegram'ga so'rang, kafolat bo'yicha almashtirishni tekshiring"),
  D("yellow", "pain", "rangi o'ch", "Mahsulot sifati bo'yicha muammo", "Kafolat bo'yicha almashtirishni taklif qiling"),
  D("yellow", "pain", "dostavka", "Yetkazib berish mavzusi — kechikish yoki adashish bo'lishi mumkin", "Uzr so'rang va logistikaga yetkazing"),
  D("green", "buy", "olaman", "Sotib olishga tayyorlik", "Manzil, vaqt va to'lov usulini darhol aniqlang"),
  D("green", "buy", "беру", "Sotib olishga tayyorlik", "Manzil va to'lovni aniqlang"),
  D("green", "buy", "buyurtma", "Buyurtma mavzusi", "Modelni, rangni va manzilni tasdiqlang"),
  D("green", "buy", "заказ", "Buyurtma mavzusi", "Model, rang, manzilni tasdiqlang"),
  D("green", "buy", "manzil", "Yetkazib berish manzili — bitim yopilmoqda", "Vaqtni va to'lov usulini (naqd, Click/Payme) kelishing"),
  D("green", "buy", "payme", "To'lov usuli tanlanmoqda", "Summani va yetkazish vaqtini tasdiqlang"),
  D("green", "buy", "ofisga kel", "Ofisga tashrif — taqib ko'rish", "Sana va soatni aniq kelishing, lokatsiya yuboring"),
  D("green", "buy", "kelishdik", "Kelishuv", "Keyingi qadamni sana bilan takrorlang"),
  D("green", "buy", "tashlab bering", "Mijoz rasmlar/ma'lumot so'radi — qiziqish bor", "Telegram'ga modellar va narxni yuboring, javobni kuzating"),
  D("red", "risk", "sud", "Mijoz sud jarayonini tilga oldi — huquqiy xavf va shoshilinch holat", "Darhol rahbarga eskalatsiya qiling, va'da bermang, huquq bo'limi bilan tekshiring"),
  D("red", "risk", "суд", "Mijoz sud jarayonini tilga oldi — huquqiy xavf", "Rahbarga eskalatsiya, yozma javob tayyorlang"),
  D("red", "risk", "shikoyat", "Mijoz shikoyat qilmoqda — norozilik darajasi yuqori", "Uzr so'rang, faktni yozib oling, muddat bilan yechim va'da qiling"),
  D("red", "risk", "жалоб", "Shikoyat — norozilik", "Faktni yozing, muddatli yechim bering"),
  D("red", "risk", "bekor qil", "Xizmatdan voz kechish signali — bitim yo'qolish arafasida", "Sababni ochiq so'rang, rahbar darajasida saqlash taklifi bering"),
  D("red", "risk", "расторг", "Shartnomani bekor qilish — bitim yo'qoladi", "Sababni aniqlang, rahbarga eskalatsiya"),
  D("red", "risk", "откаж", "Voz kechish signali", "Sababni ochiq so'rang"),
  D("red", "objection", "конкурент", "Raqobatchi tilga olindi", "Taqqoslash mezonini aniqlang"),
  D("red", "objection", "qimmat", "Narx e'tirozi — qiymat tushuntirilmagan bo'lishi mumkin", "Ssenariy: oddiy chexol 2–3 oyda almashadi (yiliga ~1 mln so'm), Pitaka bitta — kafolat va Aramid bilan. Narxni qiymat bilan birga ayting"),
  D("red", "objection", "дорого", "Narx e'tirozi", "Qiymatni raqamda ko'rsating"),
  D("red", "risk", "ishonmayman", "Ishonch yo'qolgan — sotuv to'xtaydi", "Dalil bering: shartnoma, kafolat, mavjud mijoz namunasi"),
  D("red", "risk", "не доверя", "Ishonchsizlik", "Dalil va kafolat bering"),
  D("red", "risk", "aldadi", "Mijoz aldanganini aytmoqda — ishonch inqirozi", "Faktni yozib oling, rahbarga eskalatsiya qiling"),
  D("red", "risk", "обман", "Aldanish da'vosi — ishonch inqirozi", "Faktni yozing, eskalatsiya qiling"),
  D("red", "risk", "вернуть деньги", "Pul qaytarish talabi", "Rahbarsiz va'da bermang"),

  // ---------- SARIQ: ikkilanish ----------
  D("yellow", "objection", "o'ylab ko'ra", "Kechiktirish — qaror qabul qilinmagan", "Aniq nima noaniqligini so'rang va keyingi aloqa sanasini kelishing"),
  D("yellow", "objection", "подума", "Kechiktirish — qaror qabul qilinmagan", "Aniq savolni oching, sana kelishing"),
  D("yellow", "objection", "keyinroq", "Kechiktirish — muddat aniq emas", "Aniq sana va vaqt taklif qiling"),
  D("yellow", "objection", "позже", "Kechiktirish", "Aniq sana taklif qiling"),
  D("yellow", "objection", "прайс", "Faqat narx so'raldi", "Ehtiyojni oching"),
  D("yellow", "objection", "пришлите цен", "Faqat narx so'raldi", "Ehtiyojni oching"),
  D("yellow", "objection", "vaqt yo'q", "Suhbat uzilmoqda — diqqat yo'q", "Qulay vaqtni so'rab, qayta qo'ng'iroqni kalendarga yozing"),
  D("yellow", "objection", "некогда", "Suhbat uzilmoqda", "Qayta qo'ng'iroq vaqtini kelishing"),

  // ---------- YASHIL: ijobiy ----------
  D("green", "buy", "roziman", "Rozilik bildirildi", "Rozilikni yozma tasdiqlang"),
  D("green", "buy", "согласен", "Rozilik bildirildi", "Yozma tasdiqlang"),
  D("green", "buy", "to'lov qil", "To'lov niyati", "To'lov sanasini aniqlang"),
  D("green", "buy", "оплат", "To'lov mavzusi", "Sana va summani aniqlang"),
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
      B + "\\d[\\d\\s.,]{2,}\\s*(?:so['‘’ʻʼ`]?m|sum|сум|сўм|usd|доллар\\p{L}*|dollar|mln|млн|ming|тыс\\p{L}*)" + E
      + "|" + B + "(?:bir|ikki|uch|to'rt|besh|olti|yetti|sakkiz|to'qqiz|o'n|yigirma|o'ttiz|qirq|ellik|yuz|один|дв[ае]|три|четыре|пят\\p{L}*|шест\\p{L}*|сем\\p{L}*|восем\\p{L}*|девят\\p{L}*|десят\\p{L}*|сто)\\s+(?:million\\p{L}*|milliard\\p{L}*|ming|миллион\\p{L}*|тысяч\\p{L}*|млрд)" + E, "giu") },
  { kind: "phone", label: "Telefon", re: /(?:\+?998[\s-]?)?\b\d{2}[\s)-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g },
  { kind: "email", label: "Email", re: /[\w.+-]+@[\w-]+\.[\w.]{2,}/gi },
  { kind: "doc",   label: "Hujjat", re: Wg("shartnoma\\p{L}*", "hisob(?:-faktura)?", "akt", "договор\\p{L}*", "счёт", "счет", "invoice", "акт", "коммерческое предложение", "tijorat taklif\\p{L}*") },
];

// Ochiq savol boshlovchilari — §F.3 "to'g'ri savollar" mezoni uchun
export const OPEN_Q = W("nima\\p{L}*", "nega", "qanday", "qanaqa", "qaysi", "qachon", "qancha", "kim", "qayer\\p{L}*", "nechta", "sabab\\p{L}*",
                        "что", "почему", "зачем", "как", "как[оа]\\p{L}*", "какие", "когда", "сколько", "кто", "где");
export const GREET = W("assalom\\p{L}*", "salom", "alaykum", "xayrli", "здравствуйте", "добрый\\s+(?:день|вечер)", "доброе утро", "приветствую", "алло", "здрасьте");
export const INTRO = W("pitaka\\p{L}*", "питак\\p{L}*", "mening ismim", "меня зовут", "kompaniyasidan", "компании", "bo'laman", "bezovta qil\\p{L}*", "звоню из", "по поводу", "aloqaga chiq\\p{L}*");
export const CLOSE = W("xayr", "salomat bo'ling", "ko'rishguncha", "rahmat", "yaxshi kun", "до свидания", "всего доброго", "спасибо", "хорошего дня", "созвонимся", "на связи");
// Pitaka qiymati (ssenariy «Mini taqdimot» va «Narx va kafolat»): Aramid, yengillik, kafolat, rasmiy diler, qaytarish.
export const VALUE = W("aramid\\p{L}*", "арамид\\p{L}*", "po'lat\\p{L}*", "bronjilet\\p{L}*", "bronijilet\\p{L}*", "18 gramm", "yengil\\p{L}*", "yupqa\\p{L}*", "sirpanmay\\p{L}*", "barmoq izi",
                      "kafolat\\p{L}*", "garantiya\\p{L}*", "rasmiy diler\\p{L}*", "original\\p{L}*", "qaytarib ol\\p{L}*", "10 kun\\p{L}*", "premium", "himoya\\p{L}*", "bepul yetkaz\\p{L}*",
                      "гаранти\\p{L}*", "кафолат\\p{L}*", "арамид\\p{L}*", "официальн\\p{L}*", "оригинал\\p{L}*", "лёгк\\p{L}*", "тонк\\p{L}*", "защит\\p{L}*", "кевлар\\p{L}*");
export const NEXT_STEP = W("yuboraman", "jo'nataman", "tashlab beraman", "tashlayman", "qo'ng'iroq qilaman", "bog'lanaman", "yozaman", "eslatib qo'yaman",
                           "rasmiylashtir\\p{L}*", "bron qil\\p{L}*", "kuryer\\p{L}*", "olib boraman", "lokatsiya", "ofisga kel\\p{L}*", "kelishdik",
                           "отправлю", "перезвоню", "позвоню", "скину", "напишу", "свяжусь", "оформ\\p{L}*", "курьер\\p{L}*");
// §4.C shoshilinchlik — muddat va tezkorlik signallari
export const URGENCY = W("shoshilinch\\p{L}*", "tezda", "zudlik\\p{L}*", "bugunoq", "ertagacha", "muddat\\p{L}*", "keyingi oy\\p{L}*", "shu hafta",
                         "срочн\\p{L}*", "быстр\\p{L}*", "до конца", "дедлайн\\p{L}*", "на следующей неделе", "в этом месяце");
