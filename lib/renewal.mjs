// M14 — Qayta sotuv va cross-sell (TZ §6.3).
//
// O'lchov (2026-09-05) modul mazmunini o'zgartirdi. TZ "shartnoma muddati tugashi"ga
// asoslangan renewal mexanizmini nazarda tutadi, lekin bazada boshqa manzara:
//
//   • 142 mijozdan 12 tasi (8%) ikkinchi marta sotib olgan — qayta sotuv deyarli yo'q
//   • 283 yutilgan bitimdan 129 tasi mijozga BOG'LANMAGAN — kimga sotishni bilib bo'lmaydi
//   • Qayta sotib olish oralig'i: median 337 kun (yillik sikl), lekin atigi 11 juftlikda
//
// Shuning uchun bu modul "muddat kuzatuvchi" emas, REAKTIVATSIYA ro'yxati.
// Asosiy g'oya: yaqinda uzilgan mijozni qaytarish oson, 4 yil oldingisini deyarli imkonsiz.
// Ro'yxat shuning uchun eng eskisi emas, ENG YAQINDA uzilgani bo'yicha tartiblanadi.
import { cached } from "./cache.mjs";
import * as dir from "./directory.mjs";

const TTL = 5 * 60e3;
const PORTAL = process.env.BITRIX_PORTAL || "http://127.0.0.1:8099";
const CYCLE = 337;                 // o'lchangan median qayta sotib olish oralig'i
const WINDOW = Math.round(CYCLE * 0.75);   // shundan keyin "muddati keldi"

const CAT = { "0": "Savdo Sun High Tech", "1": "Kuzatuv va servis", "2": "Loyiha ijrosi", "3": "Tender" };

// O'lchangan yagona haqiqiy cross-sell yo'li: konsultatsiyadan reviziyaga (3 holat).
// Boshqa yo'llar bittadan uchraydi — tavsiya berish uchun dalil yetarli emas.
const CROSS = { "1": { to: "Savdo Sun High Tech", seen: 0, why: "Servis mijozi tizimni kengaytiradi — real ma'lumotda qayta o'lchanadi (§10.4)" } };

const days = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : null);
const custKey = (d) => {
  const c = String(d.COMPANY_ID || "0"), k = String(d.CONTACT_ID || "0");
  return c !== "0" ? `C${c}` : k !== "0" ? `K${k}` : null;
};

export const renewals = (bx, owner = null) => cached(`renew:${owner || "all"}`, TTL, async () => {
  const { items, total: wonJami } = await bx.listAll("crm.deal.list", {
    filter: { STAGE_SEMANTIC_ID: "S", ...(owner ? { ASSIGNED_BY_ID: owner } : {}) },
    select: ["ID", "TITLE", "CATEGORY_ID", "CLOSEDATE", "DATE_CREATE", "OPPORTUNITY",
             "CURRENCY_ID", "COMPANY_ID", "CONTACT_ID", "ASSIGNED_BY_ID"],
    order: { CLOSEDATE: "DESC" }, maxItems: 1000,
  });

  const linked = [], orphan = [];
  for (const d of items) (custKey(d) ? linked : orphan).push(d);

  const byCust = new Map();
  for (const d of linked) {
    const k = custKey(d);
    if (!byCust.has(k)) byCust.set(k, []);
    byCust.get(k).push(d);
  }

  const customers = [...byCust.entries()].map(([k, deals]) => {
    const sorted = deals.filter((d) => d.CLOSEDATE)
      .sort((a, b) => new Date(b.CLOSEDATE) - new Date(a.CLOSEDATE));
    const last = sorted[0] || deals[0];
    const since = days(last.CLOSEDATE);
    const cat = String(last.CATEGORY_ID);
    const amount = deals.reduce((a, d) => a + Number(d.OPPORTUNITY || 0), 0);
    // Qaytarish ehtimoli vaqt bilan tez tushadi — bu tartiblash uchun asos.
    const band = since === null ? "?"
      : since < WINDOW ? "faol"
      : since <= 500   ? "yaqinda"
      : since <= 1000  ? "uzoq"
      : "yo'qolgan";
    return {
      key: k, deals: deals.length, repeat: deals.length > 1,
      lastId: last.ID, lastTitle: last.TITLE || `Bitim #${last.ID}`,
      lastAt: last.CLOSEDATE, firstAt: sorted.length ? sorted[sorted.length - 1].CLOSEDATE : null, since, band,
      category: CAT[cat] || cat, categoryId: cat,
      owner: String(last.ASSIGNED_BY_ID || "?"),
      amount, url: `${PORTAL}/crm/deal/details/${last.ID}/`,
      cross: CROSS[cat] || null,
    };
  });

  const of = (b) => customers.filter((c) => c.band === b);
  // Ish ro'yxati: eng yaqinda uzilgani birinchi — qaytarish ehtimoli eng yuqori.
  const work = of("yaqinda").sort((a, b) => a.since - b.since);
  const far = of("uzoq").sort((a, b) => a.since - b.since);

  // TZI P0-04: ilgari 40 ta bilan kesilardi — karta 40 derdi, haqiqiy soni ko'p bo'lishi mumkin edi
  const WORK_MAX = 1000;
  const { rows: workNamed } = await dir.decorate(bx, work.slice(0, WORK_MAX), "owner", "ownerName");
  const repeatCount = customers.filter((c) => c.repeat).length;

  // Joriy CRM ma'lumotida qayta xarid oralig'i: bir mijozning ketma-ket ikki xaridi orasidagi kun.
  // Bir kunda yopilgan bitimlar (0 kun) — bitta xaridning bo'laklari bo'lishi mumkin, chiqariladi.
  const oraliqlar = []; let birKunda = 0;
  for (const deals of byCust.values()) {
    const ts = deals.map((d) => (d.CLOSEDATE ? new Date(d.CLOSEDATE).getTime() : NaN)).filter(Number.isFinite).sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) { const k = Math.round((ts[i] - ts[i - 1]) / 864e5); if (k < 1) birKunda++; else oraliqlar.push(k); }
  }
  oraliqlar.sort((a, b) => a - b);
  const sanalar = items.map((d) => d.CLOSEDATE).filter(Boolean).sort();
  const olchov = {
    oraliqMedian: oraliqlar.length ? oraliqlar[Math.floor(oraliqlar.length / 2)] : null,
    oraliqSoni: oraliqlar.length, birKunda,
    engEski: sanalar[0] || null, engEskiKun: days(sanalar[0] || null),
  };

  const natija = {
    cycle: CYCLE, window: WINDOW, olchov,
    totals: {
      wonDeals: items.length,
      wonTotal: Math.max(Number(wonJami) || 0, items.length),
      workTotal: work.length,
      linked: linked.length,
      orphan: orphan.length,
      orphanShare: items.length ? +(orphan.length / items.length * 100).toFixed(1) : 0,
      customers: customers.length,
      repeat: repeatCount,
      repeatShare: customers.length ? +(repeatCount / customers.length * 100).toFixed(1) : 0,
    },
    bands: [
      { band: "faol",      label: "Faol",              count: of("faol").length,      note: `oxirgi ${WINDOW} kun ichida sotib olgan` },
      { band: "yaqinda",   label: "Yaqinda uzilgan",   count: work.length,            note: "qaytarish ehtimoli eng yuqori — birinchi navbatda" },
      { band: "uzoq",      label: "Uzoq uzilgan",      count: far.length,             note: "1–3 yil oldin — qaytarish qiyin, lekin mumkin" },
      { band: "yo'qolgan", label: "Yo'qolgan",         count: of("yo'qolgan").length, note: "3 yildan ortiq — amalda yo'qotilgan" },
    ],
    work: workNamed,
    far: far.slice(0, 20),
    crossPaths: Object.entries(CROSS).map(([id, v]) => ({ from: CAT[id] || id, ...v })),
    portal: PORTAL,
  };
  // Explain oynasi uchun to'liq ro'yxatlar — JSON'ga chiqmaydi, keshda turadi
  Object.defineProperty(natija, "tafsil", { value: { customers, orphan }, enumerable: false });
  return natija;
});
