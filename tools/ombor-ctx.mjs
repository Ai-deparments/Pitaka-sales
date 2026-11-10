// ombor-ctx.mjs — tezkor-ombor uchun o'qiydigan funksiyalar (Odoo MCP orqali, FAQAT o'qish).
// `odoo(tool, args)` ni ijrochi yozadi (odoo-mcp.mjs): agentning Odoo MCP kalitidan bitta chaqiruv.
// Har funksiya — 1–2 so'rov (MCP tezlik chegarasi: 27 tez so'rov → -32004, 60 s kutish).
//
// MCP kontrakti (ijrochi tajribada aniqladi, 038):
//  - odoo_read_group: fields da agregat SHART ("quantity:sum"), son — alohida "__count";
//    javob {groups:[[...groupby qiymatlari, ...aggregates qiymatlari]], groupby:[…], aggregates:[…]};
//    many2one — {id, name} yoki null.
//  - odoo_search_count → {count: N}.
//  - Yopiq modelga domen ORQALI o'tish ishlaydi (location_id.usage, warehouse_id, order_id.receipt_status).
// Ma'lumot tuzoqlari (038): virtual joylarda ±26,7 mlrd (Production/Inventory adjustment) — faqat
// warehouse_id != false; 10 ta xarid buyurtmasida summa buzilgan (amount_total_cc > 1e9) — chiqariladi.

const nomi = (v) => (v && typeof v === "object" ? (Array.isArray(v) ? v[1] : v.name) : v ?? "—");
const ilike = (maydon, soz) => soz.map((w) => [maydon, "ilike", w]);
const TASDIQ = ["state", "in", ["purchase", "done"]];
const HAQIQIY_OMBOR = ["warehouse_id", "!=", false];
const BUZUQ = 1e9;                       // amount_total_cc dan katta — kiritish xatosi (038)
const SANA = "date_approve";             // oyna qaysi sanadan: tasdiqlangan sana. Eталон boshqa sana bilan olingan bo'lsa — shu yerda o'zgartiring
const OMBOR_TOVAR = ["is_storable", "=", true];   // Odoo 19: omborda hisobga olinadigan tovar. Serverda tekshiring (038: 1 330)

// read_group javobini obyektlar ro'yxatiga aylantiramiz.
export function guruhlar(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;                                       // eski shakl — o'zi obyektlar
  const kalit = [...(res.groupby || []), ...(res.aggregates || [])].map((k) => k.split(":")[0]);
  return (res.groups || []).map((g) => Object.fromEntries(kalit.map((k, i) => [k, g[i]])));
}
const sanoq = (res) => (res && typeof res === "object" ? res.count : res);

const TZ_SOAT = 5;                                                          // Asia/Tashkent
function utcOraliq(R) {
  const f = (s, soat) => new Date(new Date(`${s}T${soat}Z`).getTime() - TZ_SOAT * 3600e3).toISOString().slice(0, 19).replace("T", " ");
  return [f(R.from, "00:00:00"), f(R.to, "23:59:59")];
}

export function ctxYasa(odoo) {
  const rg = async (model, domain, fields, groupby) => guruhlar(await odoo("odoo_read_group", { model, domain, fields, groupby }));
  const cnt = async (model, domain) => sanoq(await odoo("odoo_search_count", { model, domain }));

  return {
    async nomenklatura() {
      return { jami: await cnt("product.product", []), ombor: await cnt("product.product", [OMBOR_TOVAR]) };
    },
    async pozitsiyalar() {                                                  // qty_available — hisoblanadigan, faqat filtr
      const jami = await cnt("product.product", [OMBOR_TOVAR]);
      const bor = await cnt("product.product", [OMBOR_TOVAR, ["qty_available", ">", 0]]);
      return { jami, bor, nol: jami - bor };
    },
    async omborlar() {
      const g = await rg("stock.quant", [HAQIQIY_OMBOR], ["__count", "quantity:sum"], ["warehouse_id"]);
      return g.map((x) => ({ ombor: nomi(x.warehouse_id), miqdor: x.quantity ?? 0, yozuv: x.__count ?? 0 }));
    },
    async topKategoriya() {
      const g = await rg("stock.quant", [HAQIQIY_OMBOR], ["quantity:sum"], ["product_categ_id"]);
      return g.map((x) => ({ kategoriya: nomi(x.product_categ_id), miqdor: x.quantity ?? 0 }));
    },
    async xaridHolat() {
      const g = await rg("purchase.order", [], ["__count"], ["state"]);
      const h = { draft: 0, sent: 0, "to approve": 0, purchase: 0, done: 0, cancel: 0 };
      for (const x of g) h[x.state] = x.__count ?? 0;
      return h;
    },
    async yolda() {                                                         // 2 so'rov
      const st = await rg("purchase.order", [TASDIQ, ["receipt_status", "in", ["pending", "partial"]]], ["__count"], ["receipt_status"]);
      const qt = await rg("purchase.order.line", [["state", "=", "purchase"]], ["product_qty:sum", "qty_received:sum"], ["state"]);
      const k = (s) => st.find((x) => x.receipt_status === s)?.__count ?? 0;
      return { kutilmoqda: k("pending"), qisman: k("partial"), buyurildi: qt[0]?.product_qty ?? 0, keldi: qt[0]?.qty_received ?? 0 };
    },
    async buyurtmalar(R) {                                                  // 2 so'rov: summa (buzuqsiz) + buzuqlar soni
      const [a, b] = utcOraliq(R);
      const oyna = [TASDIQ, [SANA, ">=", a], [SANA, "<=", b]];
      const g = await rg("purchase.order", [...oyna, ["amount_total_cc", "<=", BUZUQ]], ["__count", "amount_total:sum", "amount_total_cc:sum"], ["currency_id"]);
      const chiqarildi = await cnt("purchase.order", [...oyna, ["amount_total_cc", ">", BUZUQ]]);
      return {
        soni: g.reduce((s, x) => s + (x.__count ?? 0), 0) + (chiqarildi || 0),
        summa: g.map((x) => ({ valyuta: nomi(x.currency_id), summa: x.amount_total ?? 0 })),
        kompaniya: g.reduce((s, x) => s + (x.amount_total_cc ?? 0), 0),
        chiqarildi: chiqarildi || 0,
      };
    },
    async topYetkazuvchi(R) {
      const [a, b] = utcOraliq(R);
      const g = await rg("purchase.order", [TASDIQ, [SANA, ">=", a], [SANA, "<=", b], ["amount_total_cc", "<=", BUZUQ]],
        ["__count", "amount_total_cc:sum"], ["partner_id"]);
      return g.map((x) => ({ yetkazuvchi: nomi(x.partner_id), summa: x.amount_total_cc ?? 0, valyuta: "", soni: x.__count ?? 0 }))
        .sort((p, q) => q.summa - p.summa);                                 // kompaniya valyutasida — bitta valyuta, solishtirsa bo'ladi
    },
    async ishlabChiqarish() {
      const g = await rg("mrp.production", [], ["__count"], ["state"]);
      const holat = {};
      for (const x of g) holat[x.state] = x.__count ?? 0;
      return { holat };
    },
    async qoldiq(soz) {
      const g = await rg("stock.quant", [...ilike("product_id.name", soz), HAQIQIY_OMBOR],
        ["quantity:sum", "available_quantity:sum"], ["product_id", "product_uom_id"]);
      const rows = g.map((x) => ({ product: nomi(x.product_id), qty: x.quantity ?? 0, available: x.available_quantity, uom: nomi(x.product_uom_id) }));
      return { rows, jami_mos: rows.length };
    },
    async ochiqBuyurtma(soz) {                                              // 2 so'rov
      const jami_mos = await cnt("product.product", ilike("name", soz));
      if (!jami_mos) return { jami_mos: 0 };
      const g = await rg("purchase.order.line", [...ilike("product_id.name", soz), ["state", "=", "purchase"],
        ["order_id.receipt_status", "in", ["pending", "partial"]]], ["__count", "product_qty:sum", "qty_received:sum"], ["order_id"]);
      return { jami_mos, qator: g.reduce((s, x) => s + (x.__count ?? 0), 0), buyurtma: g.length,
        kutilmoqda: g.reduce((s, x) => s + ((x.product_qty ?? 0) - (x.qty_received ?? 0)), 0) };
    },
  };
}
