// CRM tozalash — ma'lumot to'liqligini kuzatish.
// Maqsad: forecast noto'g'ri chiqishining sababini ko'rsatish va tuzatishni oson qilish.
import { cached } from "./cache.mjs";
import { dicts } from "./api.mjs";
import * as rng from "./range.mjs";
import * as dir from "./directory.mjs";

const TTL = 3 * 60e3;
const PORTAL = process.env.BITRIX_PORTAL || "http://127.0.0.1:8099";
const daysSince = (iso) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : 9999;

// Har bir tekshiruv: nimani qidiradi, nega muhim, qanday tuzatiladi.
export const CHECKS = [
  { id: "kontakt", label: "Kontakt/kompaniya yo‘q", weight: 3,
    why: "Mijoz kim ekani yozilmagan — kim bilan gaplashishni bilib bo‘lmaydi",
    fix: "Bitimni oching → «Mijoz» bo‘limiga kontakt yoki kompaniyani biriktiring",
    test: (d) => !d.contactId && !d.companyId },
  { id: "summa", label: "Summa kiritilmagan", weight: 3,
    why: "Forecast va reja bajarilishi shu raqamdan hisoblanadi",
    fix: "Bitimni oching → «Summa» maydoniga taxminiy qiymatni yozing",
    test: (d) => !d.amount },
  { id: "sana", label: "Yopilish sanasi yo‘q", weight: 2,
    why: "Qaysi oyga tegishli ekani aniqlanmaydi",
    fix: "Bitimni oching → «Yopilish sanasi» ni belgilang",
    test: (d) => !d.closeDate },
  // TZI P0-02: sananing TURI aniq aytilsin. Bu maydon — CRM yozuvining oxirgi
  // o'zgarish vaqti (write_date), mijoz bilan oxirgi ALOQA vaqti emas. Avtomatika
  // yozuvga tegsa ham u «yangi» bo'lib ko'rinadi, shuning uchun nom to'g'rilandi.
  { id: "jim", label: "Yozuv 30+ kundan beri o‘zgarmagan", weight: 2,
    why: "CRM'da yozuvga 30 kundan beri tegilmagan. DIQQAT: bu yozuvning oxirgi tahrir vaqti, mijoz bilan oxirgi aloqa vaqti emas — CRM'da aloqa jurnali yo‘q",
    fix: "Bitimni oching: holat o‘zgarmagan bo‘lsa mijozga qo‘ng‘iroq qiling yoki bitimni yoping",
    test: (d) => d.idleDays > 30 },
  { id: "qadam", label: "Keyingi qadam belgilanmagan", weight: 1,
    why: "Rejalashtirilgan ish yo‘q — bitim o‘z-o‘zidan ilgarilamaydi",
    fix: "Bitimda vazifa yoki qo‘ng‘iroq rejalashtiring",
    test: (d) => !d.hasNextStep },
  // TZI F11/§13: nomida sinov belgisi bor yozuvlar. MUHIM — panel ularni o'zi
  // o'chirmaydi va hisobotdan chiqarib ham tashlamaydi. Faqat ro'yxatini ko'rsatadi:
  // qaysi biri haqiqatan sinov ekanini EGASI tasdiqlaydi, keyin CRM'da arxivlanadi.
  { id: "sinov", label: "Sinov yozuviga o‘xshaydi", weight: 0,
    why: "Nomida «test / sinov / demo» bor — agar bu haqiqatan sinov bo‘lsa, hisobotdagi summa va sonni buzadi",
    fix: "Ro‘yxatni ko‘rib chiqing. Haqiqiy mijoz bo‘lsa nomini to‘g‘rilang; sinov bo‘lsa CRM'da arxivlang. Panel o‘zi o‘chirmaydi.",
    test: (d) => TEST_RE.test(String(d.title || "")) },
];

// Sinov belgisi. Kompaniya boshqa belgi ishlatsa, panel .env dagi TEST_BELGI bilan
// o'zgartiriladi (masalan TEST_BELGI="^ZZZ-"). Nom bo'yicha topish — faqat TAKLIF,
// o'chirish uchun asos emas.
const TEST_RE = new RegExp(process.env.TEST_BELGI || "\\b(test|sinov|demo|proba|пробн|тест)\\b", "i");

// Tozalash — HOZIRGI HOLAT: barcha ochiq bitim tekshiriladi. Ilgari sana oralig'i
// (DATE_CREATE, maks 366 kun) qo'llanib, summasiz 98 bitimdan 48 tasi ko'rinardi (2026-09-13).
export const scan = (bx, range) => {   // export — murabbiy ertalabki xabari uchun (2026-10-29)
  const R = rng.normalize(range, 30);
  return cached(`hyg:scan:all`, TTL, async () => {
  const dict = await dicts(bx);
  const stageName = {};
  for (const list of Object.values(dict.stages)) for (const s of list) stageName[s.id] = s.name;

  const [deals, acts] = await Promise.all([
    bx.listAll("crm.deal.list", {
      filter: { CLOSED: "N" },
      select: ["ID", "TITLE", "CATEGORY_ID", "STAGE_ID", "OPPORTUNITY", "CURRENCY_ID", "CLOSEDATE",
               "DATE_CREATE", "LAST_ACTIVITY_TIME", "CONTACT_ID", "COMPANY_ID", "ASSIGNED_BY_ID"],
      order: { OPPORTUNITY: "DESC" }, maxItems: 3000,
    }),
    // Ochiq faoliyatlar 1000 dan oshadi — 500 chegarasi "keyingi qadam yo'q" ni noto'g'ri ko'rsatardi.
    bx.listAll("crm.activity.list", {
      filter: { OWNER_TYPE_ID: 2, COMPLETED: "N" }, select: ["ID", "OWNER_ID"], maxItems: 3000,
    }).catch(() => ({ items: [] })),
  ]);
  const next = new Set((acts.items || []).map((a) => String(a.OWNER_ID)));
  const clean = (v) => (v && String(v) !== "0" ? String(v) : null);

  const rows = deals.items.map((d) => ({
    id: d.ID,
    title: d.TITLE || `Bitim #${d.ID}`,
    owner: String(d.ASSIGNED_BY_ID || "?"),
    category: dict.categories.find((c) => c.id === String(d.CATEGORY_ID))?.name || `#${d.CATEGORY_ID}`,
    stage: stageName[d.STAGE_ID] || d.STAGE_ID,
    amount: Number(d.OPPORTUNITY || 0),
    currency: d.CURRENCY_ID || "UZS",
    contactId: clean(d.CONTACT_ID), companyId: clean(d.COMPANY_ID),
    closeDate: d.CLOSEDATE || null,
    idleDays: daysSince(d.LAST_ACTIVITY_TIME),
    hasNextStep: next.has(String(d.ID)),
    url: `${PORTAL}/crm/deal/details/${d.ID}/`,
  })).map((d) => {
    const issues = CHECKS.filter((c) => c.test(d)).map((c) => c.id);
    const severity = CHECKS.filter((c) => issues.includes(c.id)).reduce((a, c) => a + c.weight, 0);
    return { ...d, issues, severity, archive: d.idleDays > 365 };
  });
  return { rows, total: deals.total };
  });
};

// Rahbar ko'rinishi: menejerlar kesimi + umumiy progress
export const overview = (bx, range) => {
  const R = rng.normalize(range, 30);
  return cached(`hyg:overview:all`, TTL, async () => {
  // Ikkala kesim: tanlangan davr va umuman ochiq turgani. Davr bo'sh chiqqanda
  // foydalanuvchi nega bo'shligini darrov ko'rsin.
  const [{ rows }, all] = await Promise.all([scan(bx, R), bx.count("crm.deal.list", { CLOSED: "N" })]);
  const active = rows.filter((r) => !r.archive);
  const byOwner = new Map();
  for (const r of active) {
    if (!byOwner.has(r.owner)) byOwner.set(r.owner, { owner: r.owner, total: 0, clean: 0, counts: {} });
    const o = byOwner.get(r.owner);
    o.total++;
    if (!r.issues.length) o.clean++;
    for (const i of r.issues) o.counts[i] = (o.counts[i] || 0) + 1;
  }
  const totals = {};
  for (const c of CHECKS) totals[c.id] = active.filter((r) => r.issues.includes(c.id)).length;
  const cleanCount = active.filter((r) => !r.issues.length).length;
  const MAXW = CHECKS.reduce((a, c) => a + c.weight, 0);
  // Bo'sh ro'yxat "hammasi toza" DEGANI EMAS — o'lchash uchun ma'lumot yo'q.
  // null qaytaramiz, aks holda davr bo'sh bo'lganda panel yashil 100% ko'rsatadi.
  const score = (list) => {
    if (!list.length) return null;
    const lost = list.reduce((a, r) => a + r.severity, 0);
    return Math.round((1 - lost / (list.length * MAXW)) * 100);
  };

  const { rows: ownerRows, resolved: ownersResolved } = await dir.decorate(bx,
    [...byOwner.values()]
      .map((o) => ({ ...o, score: score(active.filter((r) => r.owner === o.owner)) }))
      .sort((a, b) => b.total - a.total), "owner", "ownerName");

  const pick = (arr) => arr.slice(0, 8).map(
    ({ id, title, owner, category, stage, amount, currency, issues, url, idleDays }) =>
      ({ id, title, owner, category, stage, amount, currency, issues, url, idleDays }));

  return {
    checks: CHECKS.map(({ id, label, why, fix }) => ({ id, label, why, fix, count: totals[id] })),
    range: { from: R.from, to: R.to, days: R.days, label: R.label },
    scope: "all-open",
    openAll: all,
    active: active.length,
    archive: rows.length - active.length,
    clean: cleanCount,
    score: score(active),
    owners: ownerRows,
    namesResolved: ownersResolved,
    // Ikki xil ustuvorlik. Birinchisi muhimroq: pul biriktirilgan, ammo to'ldirilmagan.
    priorityValue: pick(active.filter((r) => r.issues.length && r.amount > 0)
      .sort((a, b) => b.amount - a.amount)),
    priorityWorst: pick(active.filter((r) => r.issues.length && !r.amount)
      .sort((a, b) => (b.severity - a.severity) || (a.idleDays - b.idleDays))),
  };
  });
};

// Menejer ko'rinishi: faqat o'z ro'yxati, tuzatish havolasi bilan
export const worklist = (bx, owner = null, check = null, range) => {
  const R = rng.normalize(range, 30);
  return cached(`hyg:list:${owner || "all"}:${check || "all"}`, TTL, async () => {
    const { rows } = await scan(bx, R);
    let list = rows.filter((r) => !r.archive && r.issues.length);
    if (owner) list = list.filter((r) => String(r.owner) === String(owner));
    if (check) list = list.filter((r) => r.issues.includes(check));
    return {
      total: list.length,
      rows: list.sort((a, b) => (b.severity - a.severity) || (b.amount - a.amount)).slice(0, 120)
        .map(({ id, title, owner, category, stage, amount, currency, issues, url, idleDays, severity }) =>
          ({ id, title, owner, category, stage, amount, currency, issues, url, idleDays, severity })),
      checks: CHECKS.map(({ id, label }) => ({ id, label })),
    };
  });
};
