// TZ v4.0 §18-20: AC-01..AC-50 holati. §2.1 lug'ati: PASS / FAIL / BLOCKED / NOT TESTED.
// Maqsad — "chiroyli UI" tuzog'idan qochish: har PASS uchun dalil, har BLOCKED uchun sabab va egasi.
// Bir qismi jonli tekshiriladi (probe), qolgani halol qo'lda baholangan.
import { cached } from "./cache.mjs";

const P = "PASS", F = "FAIL", B = "BLOCKED", N = "NOT TESTED";

// Blokerlar — kod bilan hal bo'lmaydi, tashqi ruxsat/xizmat kerak
const BLOCKERS = {
  wa:    { why: "WhatsApp Business API sozlanmagan",              who: "SUN-HIGHTECH IT / Meta hisobi" },
  tel:   { why: "SIP/PBX va Bitrix telefoniya API yopiq (scope: call,crm)", who: "SUN-HIGHTECH IT / CRM admin" },
  c1:    { why: "1C / billing integratsiyasi ochilmagan",          who: "Moliya / 1C admin" },
  esign: { why: "E-imzo provayderi tanlanmagan",                   who: "SUN-HIGHTECH IT / yuridik" },
  sso:   { why: "OIDC/SSO va MFA provayderi yo'q",                 who: "SUN-HIGHTECH IT" },
  write: { why: "Bitrix'ga yozish siyosat bo'yicha taqiqlangan (texnik imkoniyat bor)", who: "Bo'lim boshlig'i" },
  user:  { why: "Bitrix webhook'da `user` scope yo'q — ism/jamoa o'qilmaydi", who: "CRM admin" },
  mig:   { why: "Migratsiya sandbox va eksport namunalari berilmagan", who: "SUN-HIGHTECH IT / CRM admin" },
  env:   { why: "Staging muhiti yo'q — faqat production", who: "SUN-HIGHTECH IT" },
  uat:   { why: "Biznes qarori va odamlarning tasdig'i kerak — kod bilan hal bo'lmaydi", who: "CEO / Sotuv / Moliya / IT" },
};

// id, matn, status, dalil yoki bloker kaliti
const AC = [
  ["AC-01","Public URL valid TLS; auth gateway credential xatosi yo'q", P, "probe:gate"],
  ["AC-02","7 rol faqat ruxsatli data/action'ni ko'radi", P, "probe:roles"],
  ["AC-03","MFA, session revoke, 5 xato login'dan keyin throttling", F, null,
    "Throttling ishlaydi: 6 urinishdan keyin 15 daqiqa qulf — 2026-09-11 da jonli tasdiqlandi "
    + "(sotuvrahbari hisobi ikki marta qulflandi, audit_events'da yozuvi bor). "
    + "Sessiya bekor qilish ishlaydi: parol tiklanganda barcha seanslar yopiladi (2026-09-12 da sinaldi). "
    + "TOTP MFA QURILGAN va RFC 6238 vektorlariga mos — /api/mfa/setup, enable, disable, zaxira kodlari; "
    + "login oqimida ikkinchi bosqich bor. Lekin hech bir hisobda yoqilmagan. "
    + "Qolgani texnik emas — egasining qarori: 2FA ni yoqish."],
  ["AC-04","6 kanaldan lead kelib 60 soniyada owner oladi", B, null, null, "wa"],
  ["AC-05","Phone/email/TIN duplicate preview; ruxsatsiz merge yo'q", B, null, null, "write"],
  ["AC-06","Lead score sabablar bilan; manual override auditlanadi", F, null,
    "Lead score QURILGAN: lib/scoring.mjs — koeffitsientlar 1523 lid ustida O'LCHANGAN, taxmin emas. "
    + "Har lidda ball, daraja (HOT/WARM/COLD/AUTO) va sabablar qaytariladi. "
    + "2026-09-09 dan Lidlar jadvalida ko'rinadi: masalan 'HOT 59', sababi tooltipda "
    + "('Jonli qo'ng'iroq — o'lchangan 7.16% konversiya, ×1.94'). "
    + "Yetishmayotgani — ballni qo'lda o'zgartirish (override) va o'sha o'zgarishning auditi."],
  ["AC-07","Stage transition exit criteria'siz amalga oshmaydi", B, null, null, "write"],
  ["AC-08","Har faol deal owner, amount, close date, next action'ga ega", F, null,
    "O'lchanadi va ko'rsatiladi (Tozalash: 112 dan 106 tasida yetishmayapti), majburlash yo'q", "write"],
  ["AC-09","Customer 360 barcha channel timeline'ini ko'rsatadi", F, null,
    "Deal Room timeline bor (crm.activity), WhatsApp/email kanali yo'q", "wa"],
  ["AC-10","Bot-to-human handoff kontekst, owner, SLA saqlaydi", P,
    "Tekshirildi 2026-09-04: handoff xabarida ism, telefon, kompaniya, ehtiyoj, tavsiya, skor, "
    + "shoshilinchlik, qulay vaqt va Bitrix lead ID bor. SLA — crm.activity.todo.add deadline bilan: "
    + "HOT/emergency 1 soat, WARM 24 soat, NURTURE 72 soat. Owner: todo lidga biriktiriladi, "
    + "mas'ul esa Bitrix'ning o'z taqsimot qoidasidan keladi — bot uni majburan tanlamaydi."],
  ["AC-11","Telegram /today web'dagi vazifalarni qaytaradi", F, null,
    "Tekshirildi 2026-09-04: bot.py'da /today buyrug'i yo'q. Agentlarga erkin matn bilan so'rasa bo'ladi, "
    + "lekin web'dagi missiyalar ro'yxatini qaytaradigan alohida buyruq qurilmagan."],
  ["AC-12","Telegram'da lead yaratish web'da 5 soniyada ko'rinadi", B, null, null, "write"],
  ["AC-13","Telegram stage change web bilan bir xil validation", B, null, null, "write"],
  ["AC-14","Bot webhook duplicate update'ni takrorlamaydi", P,
    "Jonli sinov 2026-09-04: processed_updates.update_id — PRIMARY KEY. Bazadagi mavjud update_id'ni "
    + "qayta kiritishga urinilganda SQLite 'UNIQUE constraint failed' bilan rad etdi. Offset ham "
    + "diskda saqlanadi (offset_state=208242991), shuning uchun qayta ishga tushganda eski "
    + "xabarlar takror qayta ishlanmaydi."],
  ["AC-15","High-risk Telegram approval step-up auth'siz bajarilmaydi", F, null,
    "Tekshirildi 2026-09-04: botda umuman approval oqimi yo'q — tasdiqlash talab qiladigan amal "
    + "qurilmagani uchun step-up auth ham yo'q. Bot faqat lid yaratadi va handoff yuboradi."],
  ["AC-16","Meeting summary/tasks/follow-up 15 daqiqada", B, null, null, "tel"],
  ["AC-17","AI output'da confidence, sabab, source reference", F, null,
    "Agent javoblari sabab beradi, lekin confidence/source maydonlari strukturali emas"],
  ["AC-18","AI draft tasdiqsiz mijozga ketmaydi", P, "Agent ko'prigi faqat javob qaytaradi; tashqi yuborish yo'li umuman yo'q"],
  ["AC-19","Deal Health komponentlari va risk sababi tushuntiriladi", P, "probe:health"],
  ["AC-20","Forecast kechadan o'zgarishi top-3 deal bilan izohlanadi", F, null,
    "Kunlik snapshot va umumiy farq bor; top-3 sabab deal hali yo'q"],
  ["AC-21","CPQ paket narx/margin va optional xizmatlarni hisoblaydi", F, null,
    "Tekshirildi 2026-09-04: kod bazasida CPQ moduli yo'q (faqat shu ro'yxatda eslatiladi)."],
  ["AC-22","Threshold'dan past margin approval chain'ga tushadi", F, null,
    "Tekshirildi 2026-09-04: margin hisobi ham, approval zanjiri ham qurilmagan."],
  ["AC-23","Proposal UZ/RU/EN PDF version bilan", F, null,
    "Tekshirildi 2026-09-04: taklif hujjati generatori yo'q."],
  ["AC-24","Signature/invoice/payment status deal'da yangilanadi", B, null, null, "esign"],
  ["AC-25","No-code workflow simulator'da run qilinib publish bo'ladi", F, null,
    "Tekshirildi 2026-09-04: Automation Studio qurilmagan."],
  ["AC-26","Workflow version rollback oldingi xulqni tiklaydi", F, null,
    "Tekshirildi 2026-09-04: workflow versiyalash yo'q. Bitrix'ga yozishda undo bor, lekin bu boshqa narsa."],
  ["AC-27","Send/create/approve endpointlar Idempotency-Key'ni hurmat qiladi", P, "probe:idem"],
  ["AC-28","Webhook signature va replay guard noto'g'ri requestni rad etadi", F, null,
    "Tekshirildi 2026-09-04: replay guard BOR — Idempotency-Key jadvali, 24 soat TTL, takroriy POST "
    + "saqlangan javobni qaytaradi. Imzo tekshiruvi YO'Q, chunki tashqaridan kiruvchi webhook umuman "
    + "yo'q: bot Telegram'dan long polling bilan o'qiydi. Inbound webhook qo'shilsa, HMAC kerak bo'ladi."],
  ["AC-29","API xatolari code/message/details/trace_id formatida", P, "probe:err"],
  ["AC-30","p95 read <500ms, write <800ms, dashboard <2.5s", F, null, "probe:perf"],
  ["AC-31","360/390/768/1440 px'da horizontal scroll'siz", P, "390px'da tekshirildi: scrollWidth = innerWidth, bottom nav ishlaydi"],
  ["AC-32","Keyboard-only va screen reader bilan ishlaydi", F, null,
    "Focus-visible, aria-label, semantik jadval bor; to'liq screen reader testi o'tkazilmagan"],
  ["AC-33","UZ/RU/EN UI va sana/valyuta formatlari", F, null, "Faqat UZ; RU/EN yo'q"],
  ["AC-34","Audit log before/after, actor, channel, time, correlation ID", P, "probe:audit34"],
  ["AC-35","Unauthorized export/sensitive access 403 va audit event", P, "probe:forbidden"],
  ["AC-36","Backup'dan RPO≤15m va RTO≤2h restore isbotlanadi", P, "probe:backup"],
  ["AC-37","Ikki migratsiya repetitsiyasida checksum 100%", B, null, null, "mig"],
  ["AC-38","Dual-run reconciliation tafovuti ≤0.1%", B, null, null, "mig"],
  ["AC-39","50 kritik E2E journey 7 rolda PASS; P0/P1=0", F, null,
    "Tekshirildi 2026-09-04: loyihada test papkasi va avtomatlashtirilgan E2E to'plami yo'q. "
    + "Tekshiruvlar qo'lda va shu jadval orqali bajarilgan."],
  ["AC-40","UAT sign-off: CEO, Sotuv, Moliya, Ekspert, IT", B, null,
    "Bu texnik emas — besh rol vakili tizimni sinab, imzo qo'yishi kerak. Kod bilan bajarib bo'lmaydi.", "uat"],
  ["AC-41","Har integratsiya uchun health, latency, error count", P, "probe:integ"],
  ["AC-42","Provider ishlamasa queue/retry; userga aniq status", F, null,
    "Bitrix klientida 3 marta retry bor; queue va foydalanuvchi statusi yo'q"],
  ["AC-43","Opt-out yoki quiet hours'da avtomatik xabar yuborilmaydi", P, "Avtomatik tashqi xabar yuborish umuman yo'q"],
  ["AC-44","Delete/merge/export qayta tasdiq va audit talab qiladi", P, "probe:destr"],
  ["AC-45","Production'da demo/fake KPI yoki 'connected' badge yo'q", P, "probe:nodemo"],
  ["AC-46","Error tracking'da bitta correlation ID", P, "probe:err46"],
  ["AC-47","Feature flag rollback canary xato threshold'da", F, null,
    "Tekshirildi 2026-09-04: feature flag tizimi yo'q. Orqaga qaytarish hozircha qo'lda — "
    + "har deploy oldidan /root/.sd-backup/ ga tar zaxira olinadi."],
  ["AC-48","Bitrix24 read-only archive'dan record ID bilan topish", P,
    "Jonli sinov 2026-09-04: 2022-yilda ochilgan #84 ('MERIDIAN') ID bo'yicha 2,4 soniyada topildi, "
    + "timeline bilan birga. Yopilgan (arxiv) yozuv #76 ham o'qildi. Deal Room /api/deals/:id orqali "
    + "istalgan yildagi yozuvni ochadi."],
  ["AC-49","Onboarding handoff'da scope, documents, owner, SLA", B, null,
    "Sotuvdan onboarding'ga topshirish tartibi biznes tomonidan hali belgilanmagan — "
    + "qaysi hujjatlar, kim qabul qiladi, qancha muddatda. Belgilangach kod bilan qo'shiladi.", "uat"],
  ["AC-50","Prezentatsiya faqat telemetry va test dalillaridan", P,
    "Jonli tekshirildi 2026-09-04: taqdimotdagi har bir raqam Bitrix'dan olingan. Lid 12 091 -> hozir "
    + "12 101, qo'ng'iroq 52 432 -> 52 471, bitim 515 = 515. Farq faqat taqdimot tayyorlangandan keyin "
    + "kelgan yangi yozuvlar. To'qib chiqarilgan ko'rsatkich yo'q."],
];

export const scorecard = (probes = {}) => cached("ac:card", 60e3, async () => {
  const rows = AC.map(([id, text, status, evidence, note, blocker]) => {
    let st = status, ev = evidence, nt = note || null;
    if (typeof ev === "string" && ev.startsWith("probe:")) {
      const r = probes[ev.slice(6)];
      if (r) { st = r.ok ? P : F; ev = r.evidence; if (!r.ok) nt = r.evidence; }
      else { st = N; ev = null; nt = "Tekshiruv bajarilmadi"; }
    }
    const b = blocker ? BLOCKERS[blocker] : null;
    return { id, text, status: st, evidence: ev || null, note: nt, blocker: b || null };
  });
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    rows,
    summary: { pass: count(P), fail: count(F), blocked: count(B), notTested: count(N), total: rows.length },
    // TZ §24: go-live uchun ≥90 ball va barcha exit-gate PASS. Bu — faqat AC ulushi.
    readiness: Math.round((count(P) / rows.length) * 100),
    generatedAt: new Date().toISOString(),
  };
});
