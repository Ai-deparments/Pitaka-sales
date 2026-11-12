// Eng ko'p sotilgan tovarlar (2026-11-12, egasi: «qaysi tovar eng ko'p sotiladi, kim sotadi, qayerda»).
// Manba: davrda yutilgan bitimlar (STAGE_SEMANTIC_ID=S, CLOSEDATE) va ularning tovar qatorlari (crm.deal.productrows.get).
// Har tovar: nechta dona, qancha summa, nechta bitimda, kim sotgan, qaysi yo'nalishda (Sotuv bo'limi / B2C do'kon / …).
// «Nega» degan savolga CRM javob bermaydi — faqat faktlar: qayerda va kim orqali sotilgani. Qatorsiz bitimlar soni alohida ko'rsatiladi.
import { cached } from "./cache.mjs";
import * as rng from "./range.mjs";
import * as dir from "./directory.mjs";

const TTL = 5 * 60e3;
const ROW_TTL = 6 * 3600e3;      // yutilgan bitimning tovar qatorlari deyarli o'zgarmaydi
const PARALLEL = 6;

const rowsOf = (bx, id) => cached(`tovar:rows:${id}`, ROW_TTL, async () =>
  ((await bx.call("crm.deal.productrows.get", { id })).result || []).map((x) => ({
    nom: String(x.PRODUCT_NAME || "").trim(), soni: Number(x.QUANTITY) || 0, narx: Number(x.PRICE) || 0 })));

async function hammasi(items, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } }
  }));
  return out;
}

// Tovar nomidan qurilma modeli: «Edge Case for iPhone 17 Pro Max Black» → «iPhone 17 Pro Max»
export function qurilma(nom) {
  const s = String(nom || "");
  let m = s.match(/iPhone\s*(\d{2}|Air|SE)\s*(Pro\s*Max|Pro|Plus|Air|mini)?/i);
  if (m) return `iPhone ${m[1]}${m[2] ? " " + (/max/i.test(m[2]) ? "Pro Max" : m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()) : ""}`;
  if (/^\s*\d{2}\s*(pro\s*max|pro|plus|air)?\s*$/i.test(s)) return `iPhone ${s.trim().replace(/\s+/g, " ").replace(/pro max/i, "Pro Max").replace(/\bpro$/i, "Pro")}`;
  m = s.match(/\b(S\d{2}|Z\s*(?:Fold|Flip)\s*\d*)\s*(Ultra|Plus|FE)?/i);
  if (m && /samsung|galaxy|\bS\d{2}\b|fold|flip/i.test(s) && !/watch/i.test(s)) return `Samsung ${m[1].replace(/\s+/g, " ").replace(/^s/, "S").replace(/^z/, "Z")}${m[2] ? " " + m[2][0].toUpperCase() + m[2].slice(1).toLowerCase().replace(/^Fe$/, "FE") : ""}`;
  if (/iPad/i.test(s)) return "iPad";
  if (/Watch/i.test(s)) return /samsung/i.test(s) ? "Samsung Watch" : "Apple Watch";
  if (/AirPods/i.test(s)) return "AirPods";
  if (/Power\s*Bank|Charger|Qi2/i.test(s)) return "Quvvatlash";
  if (/Grip|Wallet|Card|Stand|Mount|Holder|Key|Tag/i.test(s)) return "Aksessuar";
  return "Boshqa";
}

// deals — [{ID, ASSIGNED_BY_ID, CATEGORY_ID}], rows — har bitim uchun qatorlar (yoki null), names/cats — ID → nom
export function yigish(deals, rows, names = {}, cats = {}, limit = 30) {
  const T = new Map(), Q = new Map();
  let qatorli = 0, dona = 0, summa = 0;
  const top = (m, n = 3) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([n2, c]) => ({ n: n2, c }));
  deals.forEach((d, i) => {
    const R = (rows[i] || []).filter((r) => r.soni > 0);
    if (!R.length) return;
    qatorli++;
    const kim = names[String(d.ASSIGNED_BY_ID)] || (d.ASSIGNED_BY_ID ? `#${d.ASSIGNED_BY_ID}` : "—"), qayer = cats[String(d.CATEGORY_ID)] || `#${d.CATEGORY_ID}`;
    const korildi = new Set();
    for (const r of R) {
      const nom = r.nom || "Nomsiz tovar", s = r.soni * r.narx;
      dona += r.soni; summa += s;
      const o = T.get(nom) || { nom, qurilma: qurilma(nom), soni: 0, summa: 0, bitim: 0, kim: new Map(), qayer: new Map() };
      o.soni += r.soni; o.summa += s; o.kim.set(kim, (o.kim.get(kim) || 0) + r.soni); o.qayer.set(qayer, (o.qayer.get(qayer) || 0) + r.soni);
      if (!korildi.has(nom)) { o.bitim++; korildi.add(nom); }
      T.set(nom, o);
      const q = Q.get(o.qurilma) || { nom: o.qurilma, soni: 0, summa: 0 }; q.soni += r.soni; q.summa += s; Q.set(o.qurilma, q);
    }
  });
  const tovarlar = [...T.values()].sort((a, b) => b.soni - a.soni || b.summa - a.summa)
    .map((o) => ({ nom: o.nom, qurilma: o.qurilma, soni: o.soni, summa: Math.round(o.summa), bitim: o.bitim, kim: top(o.kim), qayer: top(o.qayer, 2) }));
  return { jami: { bitim: deals.length, qatorli, qatorsiz: deals.length - qatorli, dona, summa: Math.round(summa), tur: tovarlar.length },
    tovarlar: tovarlar.slice(0, limit), qurilmalar: [...Q.values()].sort((a, b) => b.soni - a.soni).map((q) => ({ ...q, summa: Math.round(q.summa) })) };
}

const yonalishlar = (bx) => cached("tovar:cats", 30 * 60e3, async () => {
  const r = await bx.call("crm.dealcategory.list", {}).catch(() => ({ result: [] }));
  return { 0: "Sotuv bo'limi", ...Object.fromEntries((r.result || []).map((c) => [String(c.ID), c.NAME])) };
});

export const top = (bx, { range, limit = 30 } = {}) => {
  const R = rng.normalize(range, 30);
  return cached(`tovar:top:${R.rolling ? `r${R.days}` : R.key}:${limit}`, TTL, async () => {
    const { items: deals } = await bx.listAll("crm.deal.list", {
      filter: { STAGE_SEMANTIC_ID: "S", ">=CLOSEDATE": R.fromISO, "<=CLOSEDATE": R.toISO },
      select: ["ID", "ASSIGNED_BY_ID", "CATEGORY_ID"], order: { CLOSEDATE: "DESC" }, maxItems: 3000,
    });
    const [rows, cats, { names }] = await Promise.all([
      hammasi(deals, (d) => rowsOf(bx, d.ID)), yonalishlar(bx),
      dir.names(bx, deals.map((d) => d.ASSIGNED_BY_ID)).catch(() => ({ names: {} })),
    ]);
    return { range: rng.pub(R), ...yigish(deals, rows, names, cats, limit), at: new Date().toISOString() };
  });
};
