// Uch qoida nazorati.
//
// Qoidalarni Bitrix ichida "eshik" qilib qo'yish alohida ish (sozlama, kod emas).
// Bu modul esa buzilishlarni TOPADI: kim, qaysi bitimda, qachon.
// Har birida Bitrix'ga to'g'ridan-to'g'ri havola bor — bosib tuzatiladi.
//
//   Q1  Yutilgan bitimda summa yo'q      -> forecast va daromad noto'g'ri chiqadi
//   Q2  Yo'qotilgan bitimda sabab yo'q   -> nega yutqazayotganimiz bilinmaydi
//   Q3  Ochiq bitimda keyingi qadam yo'q -> bitim o'z-o'zidan ilgarilamaydi
import { cached } from "./cache.mjs";
import * as rng from "./range.mjs";
import * as dir from "./directory.mjs";

const TTL = 3 * 60e3;
const PORTAL = process.env.BITRIX_PORTAL || "http://127.0.0.1:8099";
// Summa ikki joyda saqlanadi — auditda aniqlangan. Ikkalasi ham bo'sh bo'lsagina buzilish.
const ALT_AMOUNT = process.env.BITRIX_ALT_AMOUNT_FIELD || "UF_CRM_1667284257";
const MIN_REASON = 4;          // shundan qisqa izoh sabab hisoblanmaydi
const CAP = 600;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const link = (id) => `${PORTAL}/crm/deal/details/${id}/`;
const days = (iso) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : null;

export const RULES = [
  { id: "amount", n: 1, label: "Yutilgan bitimda summa yo'q",
    why: "Summasiz bitim daromad hisobiga tushmaydi — forecast va reja bajarilishi noto'g'ri chiqadi.",
    fix: "Bitimni oching va summa maydonini to'ldiring." },
  { id: "reason", n: 2, label: "Yo'qotilgan bitimda sabab yo'q",
    why: "Sababsiz yo'qotish — takrorlanadigan xato. Nega yutqazayotganimiz hech qachon bilinmaydi.",
    fix: "Bitim izohiga qisqa sabab yozing: narx, muddat, raqobatchi, ehtiyoj yo'q." },
  { id: "nextstep", n: 3, label: "Ochiq bitimda keyingi qadam yo'q",
    why: "Rejalashtirilgan ishi yo'q bitim o'z-o'zidan ilgarilamaydi — u shunchaki qotib turadi.",
    fix: "Bitimga vazifa yoki qo'ng'iroq rejalashtiring." },
];

export const check = (bx, owner = null, range) => {
  const R = rng.normalize(range, 30);
  return cached(`rules:${owner || "all"}:${R.key}`, TTL, async () => {
    const own = owner ? { ASSIGNED_BY_ID: owner } : {};

    const [won, lost, open, acts] = await Promise.all([
      bx.listAll("crm.deal.list", {
        filter: { STAGE_SEMANTIC_ID: "S", ...own },
        select: ["ID", "TITLE", "OPPORTUNITY", "CURRENCY_ID", "ASSIGNED_BY_ID", "CLOSEDATE", ALT_AMOUNT],
        order: { CLOSEDATE: "DESC" }, maxItems: CAP,
      }),
      bx.listAll("crm.deal.list", {
        filter: { STAGE_SEMANTIC_ID: "F", ...own },
        select: ["ID", "TITLE", "COMMENTS", "ASSIGNED_BY_ID", "CLOSEDATE"],
        order: { CLOSEDATE: "DESC" }, maxItems: CAP,
      }),
      bx.listAll("crm.deal.list", {
        filter: { CLOSED: "N", ...own },
        select: ["ID", "TITLE", "STAGE_ID", "CATEGORY_ID", "ASSIGNED_BY_ID", "DATE_CREATE", "LAST_ACTIVITY_TIME"],
        order: { DATE_CREATE: "DESC" }, maxItems: CAP,
      }),
      // Bajarilmagan faoliyat = "keyingi qadam bor"
      bx.listAll("crm.activity.list", {
        filter: { OWNER_TYPE_ID: 2, COMPLETED: "N" },
        select: ["ID", "OWNER_ID"], maxItems: 800,
      }).catch(() => ({ items: [] })),
    ]);

    const hasNext = new Set((acts.items || []).map((a) => String(a.OWNER_ID)));
    const inRange = (iso) => {
      if (!iso) return false;
      const d = String(iso).slice(0, 10);
      return d >= R.from && d <= R.to;
    };
    const row = (d, extra = {}) => ({
      id: d.ID, title: d.TITLE || `Bitim #${d.ID}`,
      owner: String(d.ASSIGNED_BY_ID || "?"), url: link(d.ID), ...extra,
    });

    // --- Q1: summasiz yutilgan ---
    const v1 = won.items
      .filter((d) => num(d.OPPORTUNITY) === 0 && num(d[ALT_AMOUNT]) === 0)
      .map((d) => row(d, { closedAt: d.CLOSEDATE, recent: inRange(d.CLOSEDATE) }));

    // --- Q2: sababsiz yo'qotilgan ---
    const v2 = lost.items
      .filter((d) => !d.COMMENTS || String(d.COMMENTS).replace(/<[^>]*>/g, "").trim().length < MIN_REASON)
      .map((d) => row(d, { closedAt: d.CLOSEDATE, recent: inRange(d.CLOSEDATE) }));

    // --- Q3: keyingi qadamsiz ochiq ---
    const v3 = open.items
      .filter((d) => !hasNext.has(String(d.ID)))
      .map((d) => row(d, { idleDays: days(d.LAST_ACTIVITY_TIME || d.DATE_CREATE) }))
      .sort((a, b) => (b.idleDays ?? 0) - (a.idleDays ?? 0));

    const groups = [
      { ...RULES[0], total: won.items.length, broken: v1, inRange: v1.filter((x) => x.recent).length },
      { ...RULES[1], total: lost.items.length, broken: v2, inRange: v2.filter((x) => x.recent).length },
      { ...RULES[2], total: open.items.length, broken: v3, inRange: v3.length },
    ].map((g) => ({
      ...g,
      count: g.broken.length,
      rate: g.total ? +(g.broken.length / g.total * 100).toFixed(1) : 0,
      broken: g.broken.slice(0, 60),
    }));

    // --- mas'ullar kesimi: kimda eng ko'p ---
    const byOwner = new Map();
    for (const g of groups) {
      for (const b of g.broken) {
        if (!byOwner.has(b.owner)) byOwner.set(b.owner, { owner: b.owner, amount: 0, reason: 0, nextstep: 0, total: 0 });
        const o = byOwner.get(b.owner);
        o[g.id]++; o.total++;
      }
    }
    const { rows: owners, resolved } = await dir.decorate(bx,
      [...byOwner.values()].sort((a, b) => b.total - a.total), "owner", "ownerName");

    const totalBroken = groups.reduce((a, g) => a + g.count, 0);
    return {
      range: { from: R.from, to: R.to, days: R.days, label: R.label },
      groups, owners, namesResolved: resolved,
      totalBroken,
      // Sog'liq ballari: uchala qoida bo'yicha o'rtacha rioya foizi
      score: Math.round(100 - groups.reduce((a, g) => a + g.rate, 0) / groups.length),
      portal: PORTAL,
      generatedAt: new Date().toISOString(),
    };
  });
};
