// Odoo «SUN-HTC Call Operators» dashboard — panelda AYNAN Odoo'dagi raqamlar.
//
// Sotuv rahbari (2026-09-23): «lid ma'lumotlari noto'g'ri». To'g'ri manba — Odoo:
// My Dashboard → SUN-HTC Call Operators → davr (custom filter) → plitka → «Оператор (Авто
// танланади)» filtri. Bu modul o'sha plitkalarni adapterning `sun.dashboard.kpi` usulidan
// oladi: adapter Odoo'ning O'Z domenini (tools/sun-dashboard.json) va plitkaning o'z sana
// maydonini ishlatadi, hisob jonli (snapshot emas). Shuning uchun raqam Odoo bilan bir xil.
import { Bitrix } from "./bitrix.mjs";

// Plitka nimani sanaydi — odam tilida (formulaning o'zi sun-dashboard.json da)
const IZOH = {
  "1006": { sana: "yaratilgan sana", t: "SUN kompaniyasi · «Оператор (Авто танланади)» tanlangan · lidni call-markaz ([SUN] Call center) xodimi yoki OdooBot yaratgan · arxivlanganlar ham." },
  "1007": { sana: "yaratilgan sana", t: "«Tushgan Lead»lardan «Янги лид» holatida turib qolmaganlari: holati o'zgargan lid, managerga o'tgan yoki otkaz qilingan." },
  "863": { sana: "managerga o'tkazilgan sana (date_conversion)", t: "Call-markaz/OdooBot yaratgan, operatori bor va imkoniyatga (managerga) o'tkazilgan yozuvlar — keyin yo'qotilganlari ham." },
  "1025": { sana: "managerga o'tkazilgan sana (date_conversion)", t: "Managerga o'tkazilgan lidlardagi «Керакли қувват» (kVt) yig'indisi." },
  "1010": { sana: "yaratilgan sana", t: "Lid (imkoniyat emas), SUN, holati «Жараёнда», arxivlanmagan." },
  "1011": { sana: "yaratilgan sana", t: "Lid, SUN, holati «1-6 ой», arxivlanmagan." },
  "796": { sana: "yaratilgan sana", t: "Lid, holati «Сервис», arxivlanmagan." },
  "1009": { sana: "yaratilgan sana", t: "Lid, SUN, holati «Янги лид», arxivlanmagan — hali ishlanmagan lidlar." },
  "791": { sana: "otkaz qilingan sana (date_closed)", t: "Lid, «yo'qotilgan» deb belgilangan va arxivlangan. Odoo plitkasida kompaniya/operator sharti yo'q — hamma otkaz lidlar." },
};

let bx = null;
const client = () => {
  const url = String(process.env.BITRIX_WEBHOOK_URL || "");
  if (!/:8098\//.test(url)) return null;               // faqat Odoo adapteri shu usulni biladi
  if (!bx) bx = new Bitrix(url, { timeoutMs: 120000 });  // sovuq keshda ~15–30 s (12 ta MCP so'rovi)
  return bx;
};

// R — range.normalize natijasi. operator — faqat shu operator qatori (operator roli uchun).
export async function odooDashboard(R, { operator = null, fresh = false } = {}) {
  const c = client();
  if (!c) return { ulangan: false, sabab: "Panel Odoo adapteriga ulanmagan — bu blok faqat Odoo manbasida ishlaydi." };
  const utc = (iso) => new Date(iso).toISOString().slice(0, 19).replace("T", " ");
  const r = await c.call("sun.dashboard.kpi", { from: R.from, to: R.to, ...(fresh ? { fresh: "1" } : {}),
    // «Oxirgi N kun» — Odoo kabi aniq soatlar (hozirdan N×24 soat orqaga)
    ...(R.rolling ? { dan: utc(R.fromISO), gacha: utc(R.toISO), kalit: `d${R.days}` } : {}) });
  const v = r.result || {};
  const op = operator ? String(operator) : null;
  const plitkalar = (v.plitkalar || []).map((p) => {
    const ops = op ? p.ops.filter((x) => x.id === op) : p.ops;
    const count = ops.reduce((a, x) => a + x.count, 0);
    const sum = p.hisob === "sum" ? Math.round(ops.reduce((a, x) => a + (x.sum || 0), 0) * 100) / 100 : null;
    return { ...p, ops, count, qiymat: op ? (p.hisob === "sum" ? sum : count) : p.qiymat, izoh: IZOH[p.id] || null };
  });
  return {
    ulangan: true, range: { from: R.from, to: R.to, label: R.label, days: R.days, rolling: !!R.rolling },
    dan: v.dan, gacha: v.gacha, at: v.at, kesh: !!v.kesh, eski: !!v.eski, manba: v.manba,
    operator: op, plitkalar,
    tashqarida: op ? null : v.tashqarida,   // umumiy ko'rsatkich — operatorga tegishli emas
  };
}
