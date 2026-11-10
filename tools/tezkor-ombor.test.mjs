// node --test tezkor-ombor.test.mjs — tarmoq yo'q, Odoo yo'q: ctx soxta (sintetik raqamlar).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aniqla, javob, til, tovarNomi, lotin, oynaOraligi } from "./tezkor-ombor.mjs";
import { ctxYasa, guruhlar } from "./ombor-ctx.mjs";

const T14 = Date.UTC(2026, 9, 29, 9, 0);   // 14:00 Toshkent, 2026-10-29

const ctx = (o = {}) => ({
  nomenklatura: async () => ({ jami: 1527, ombor: 1330 }),
  pozitsiyalar: async () => ({ jami: 1330, bor: 445, nol: 885 }),
  omborlar: async () => [{ ombor: "Alfa", miqdor: 190495.89, yozuv: 454 }, { ombor: "Beta", miqdor: 3, yozuv: 3 }],
  topKategoriya: async () => [{ kategoriya: "Kabel", miqdor: 1000 }, { kategoriya: "Metall", miqdor: 51702.43 }, { kategoriya: "Panel", miqdor: 900 }],
  xaridHolat: async () => ({ draft: 143, sent: 7, purchase: 1858, done: 0, cancel: 98 }),
  yolda: async () => ({ kutilmoqda: 1200, qisman: 200, buyurildi: 664105.5, keldi: 114134.2 }),
  buyurtmalar: async () => ({ soni: 15, summa: [{ valyuta: "UZS", summa: 950000000 }, { valyuta: "USD", summa: 1200 }], kompaniya: 77054, chiqarildi: 1 }),
  topYetkazuvchi: async () => [{ yetkazuvchi: "Gamma Trade", summa: 30000, valyuta: "", soni: 12 }, { yetkazuvchi: "Delta", summa: 21000, valyuta: "", soni: 9 }],
  ishlabChiqarish: async () => ({ holat: { done: 13, cancel: 5 } }),
  qoldiq: async () => ({ rows: [{ product: "Panel 550W", qty: 120, available: 100, uom: "dona" }], jami_mos: 1 }),
  ochiqBuyurtma: async () => ({ jami_mos: 2, qator: 3, buyurtma: 2, kutilmoqda: 450 }),
  ...o,
});

// Ijrochining 10 savoli (038) — rus tilida, u yozganidek.
const ZAMER_RU = [
  ["Сколько позиций в номенклатуре, сколько складских?", "nomenklatura"],
  ["По скольким позициям сейчас есть остаток?", "pozitsiyalar"],
  ["Сколько единиц на складе Alfa?", "ombor_jami"],
  ["Какие у нас склады?", "omborlar"],
  ["Какая категория занимает больше всего на складе?", "top_kategoriya"],
  ["Сколько открытых заказов снабжения?", "ochiq_xarid"],
  ["Сколько заказанного ещё не пришло?", "yolda"],
  ["На сколько закупили в октябре?", "xarid_summa"],
  ["Что пришло сегодня на склад по приходным документам?", "yopiq"],
  ["Спиши 5 панелей со склада", null],
];
test("замер склада (038): 10 вопросов", () => {
  for (const [s, tur] of ZAMER_RU) assert.equal(aniqla(s)?.tur ?? null, tur, s);
});

const ZAMER_UZ = [
  ["Nomenklaturada nechta tovar bor?", "nomenklatura"],
  ["Omborda nechta xil tovar bor?", "pozitsiyalar"],
  ["Qaysi tovarlarning qoldig'i nolga tushgan?", "pozitsiyalar"],
  ["Alfa omborida jami nechta birlik bor?", "ombor_jami"],
  ["Qanday omborlarimiz bor?", "omborlar"],
  ["Qaysi kategoriya omborda eng ko'p joy egallaydi?", "top_kategoriya"],
  ["Ochiq xarid buyurtmalari nechta?", "ochiq_xarid"],
  ["Tasdiqlanmagan xarid buyurtmalari nechta?", "qoralama"],
  ["Buyurtma qilingan, lekin hali kelmagan tovar qancha?", "yolda"],
  ["Oktyabr oyida qancha pulga xarid qildik?", "xarid_summa"],
  ["Kecha nechta xarid buyurtmasi tasdiqlandi?", "buyurtmalar"],
  ["Oxirgi 30 kunda eng ko'p xarid qilingan yetkazuvchi kim?", "top"],
  ["Ochiq ishlab chiqarish buyurtmalari nechta?", "ishlab"],
  ["Omborda 550W panel qancha qoldi?", "qoldiq"],
  ["Invertor 5kW bo'yicha yo'lda buyurtma bormi?", "ochiq_buyurtma"],
  ["Kecha omborga nima kirim bo'ldi?", "yopiq"],
];
test("o'zbekcha savollar", () => {
  for (const [s, tur] of ZAMER_UZ) assert.equal(aniqla(s)?.tur ?? null, tur, s);
});

const AGENTGA = [
  "Invertorlar qayerda turibdi?",
  "Mening buyurtmalarim qachon keladi?",
  "Omborchi kim?",
  "Panel narxi qancha?",
  "Buyurtma ber 100 ta panel",
  "Omborda qancha?",
  "Удали заказ P00822",
  "Hisobdan chiqar 3 ta kabel",
  // sotuv agentida «buyurtma» — mijoz buyurtmasi bo'lishi mumkin: xarid so'zisiz — agentga
  "Kecha nechta buyurtma tushdi?",
  "Tasdiqlanmagan buyurtmalar nechta?",
  "Ochiq buyurtmalar nechta?",
  "Сколько заказов вчера?",
];
// 046: ijrochi topgan 9 ta «o'zgartir» iborasi + apostrofsiz va boshqa apostrofli variantlar — hammasi agentga.
const YOZISH_046 = [
  "Qoldiqni to'g'rila: SunHightech omborida 100 dona qil",
  "Omborda 5 dona panelni o'chir",
  "Perikub omborida 3 dona qo'sh",
  "Postav v ombor 20 dona kabel",
  "SunHightech omborida qoldiqni 100 dona qilib o'zgartir",
  "Kabel qoldig'ini kamaytir, 50 dona yoz",
  "Spishi 5 panelej so sklada",
  "Izmeni ostatok na sklade SunHightech na 100",
  "Xarid buyurtmasini bekor qil",
  "Omborda 5 dona panelni ochir",                       // apostrofsiz
  "Perikub omborida 3 dona qoʻsh",                      // U+02BB
  "Qoldiqni toʼgʼrila, SunHightech omborida 100 dona",  // U+02BC
  "Поставь на склад SunHightech 20 штук кабеля",
  "Omborga 10 dona panel kirit",
  "SunHightech omborida jami nechta birlik bor? 100 dona qilib qo'y",  // savol + buyruq — buyruq ustun
];
test("046: o'zgartirish so'rovi raqam bilan javob olmaydi", () => {
  for (const s of YOZISH_046) assert.equal(aniqla(s), null, s);
});

test("yozish, shaxsiy, joy va noaniq — agentga", () => {
  for (const s of AGENTGA) assert.equal(aniqla(s), null, s);
});

test("til va tovar nomi", () => {
  assert.equal(til("Какие у нас склады?"), "ru");
  assert.equal(til("Омборда нечта хил товар бор?"), "uz");
  assert.deepEqual(tovarNomi(lotin("Omborda 550W panel qancha qoldi?")), ["550w", "panel"]);
  assert.equal(tovarNomi(lotin("Omborda qancha qoldi?")), null);
});

test("oyna: oy — 1-sanadan bugungacha; o'tgan yilning oyi", () => {
  const o = oynaOraligi({ oy: 10 }, T14);
  assert.deepEqual([o.from, o.to, o.joriy], ["2026-10-01", "2026-10-29", true]);
  const d = oynaOraligi({ oy: 12 }, T14);
  assert.deepEqual([d.from, d.to, d.joriy], ["2025-12-01", "2025-12-31", false]);
  const w = oynaOraligi({ n: 7 }, T14);
  assert.deepEqual([w.from, w.to], ["2026-10-23", "2026-10-29"]);
});

test("javoblar: ijrochining eталонlari bilan bir xil shakl", async () => {
  const j = async (s) => (await javob(s, ctx(), T14)).text;
  assert.match(await j("Сколько позиций в номенклатуре, сколько складских?"), /^В номенклатуре 1 527 позиций, из них складских \(учитываемых на складе\) — 1 330\./);
  assert.match(await j("По скольким позициям сейчас есть остаток?"), /^Позиций с остатком: 445, с нулевым остатком: 885 \(из 1 330 складских\)/);
  assert.match(await j("Сколько единиц на складе Alfa?"), /^На складе «Alfa» — 190 495,89 ед\. \(454 записей\)\. Показаны склады, где сейчас есть остаток.*Только настоящие склады.*сложены разные единицы/);
  assert.match(await j("Какие у нас склады?"), /^Склады: «Alfa» — 190 495,89 ед\. \(454 записей\); «Beta» — 3 ед\..*пустые склады этим доступом не видны/);
  assert.match(await j("Какая категория занимает больше всего на складе?"), /^Больше всего на складе: «Metall» — 51 702,43 ед\./);
  assert.match(await j("Сколько открытых заказов снабжения?"), /подтверждены — 1 858, черновики — 143.*закрыты \(done\) — 0\. Заказы в системе не закрываются.*= 2 008/);
  assert.match(await j("Сколько заказанного ещё не пришло?"), /заказано 664 105,5, пришло 114 134,2 — не пришло ≈ 549 971,3 ед\./);
  const okt = await j("На сколько закупили в октябре?");
  assert.match(okt, /^Октябрь \(2026-10-01 — 2026-10-29, месяц ещё идёт\): подтверждено заказов на закупку — 15, сумма: 950 000 000 UZS; 1 200 USD \(в валюте компании 77 054\)\. 1 заказ\(а\) с явно ошибочной суммой/);
  assert.match(await j("Что пришло сегодня на склад по приходным документам?"), /закрыты ключом доступа к Odoo.*Ответить не могу и угадывать не буду/);
  assert.match(await j("Oxirgi 30 kunda eng ko'p xarid qilingan yetkazuvchi kim?"), /Gamma Trade — 30 000 kompaniya valyutasida \(12\)/);
  assert.match(await j("Ochiq ishlab chiqarish buyurtmalari nechta?"), /Ochiq ishlab chiqarish buyurtmalari: 0 ta .*bajarilgan — 13 ta/);
});

test("ma'lumot kelmasa — null", async () => {
  const bosh = ctx({ nomenklatura: async () => ({}), omborlar: async () => [], xaridHolat: async () => null, buyurtmalar: async () => null });
  for (const s of ["Сколько позиций в номенклатуре?", "Какие у нас склады?", "Сколько открытых заказов снабжения?", "На сколько закупили в октябре?"])
    assert.equal(await javob(s, bosh, T14), null, s);
});

// --- ombor-ctx.mjs: MCP javob shakli (038) va domenlar ---
test("guruhlar(): MCP massivlarini obyektga aylantiradi", () => {
  const r = guruhlar({ groups: [[{ id: 4, name: "Alfa" }, 454, 190495.89], [null, 1728, 32027.3]],
    groupby: ["warehouse_id"], aggregates: ["__count", "quantity:sum"] });
  assert.deepEqual(r[0], { warehouse_id: { id: 4, name: "Alfa" }, __count: 454, quantity: 190495.89 });
  assert.equal(r[1].warehouse_id, null);
});

test("ctx: so'rovlar soni, domenlar va buzuq summalar chiqarilishi", async () => {
  const chaqiruv = [];
  const odoo = async (tool, a) => {
    chaqiruv.push({ tool, ...a });
    if (tool === "odoo_search_count") return { count: JSON.stringify(a.domain).includes('"amount_total_cc",">"') ? 1 : 445 };
    if (a.model === "stock.quant") return { groups: [[{ id: 4, name: "Alfa" }, 454, 190495.89]], groupby: a.groupby, aggregates: a.fields };
    if (a.model === "purchase.order" && a.groupby[0] === "currency_id")
      return { groups: [[{ id: 1, name: "UZS" }, 14, 9.5e8, 70000]], groupby: a.groupby, aggregates: a.fields };
    return { groups: [], groupby: a.groupby, aggregates: a.fields };
  };
  const c = ctxYasa(odoo);
  const om = await c.omborlar();
  assert.deepEqual(om, [{ ombor: "Alfa", miqdor: 190495.89, yozuv: 454 }]);
  assert.deepEqual(chaqiruv[0].domain, [["warehouse_id", "!=", false]]);          // virtual joylarsiz
  chaqiruv.length = 0;
  const b = await c.buyurtmalar({ from: "2026-10-01", to: "2026-10-29" });
  assert.equal(chaqiruv.length, 2);                                                 // tezlik chegarasi: 2 so'rov
  assert.deepEqual(b, { soni: 15, summa: [{ valyuta: "UZS", summa: 9.5e8 }], kompaniya: 70000, chiqarildi: 1 });
  const d = JSON.stringify(chaqiruv[0].domain);
  assert.match(d, /"amount_total_cc","<=",1000000000/);
  assert.match(d, /"date_approve",">=","2026-09-30 19:00:00"/);                    // Toshkent 00:00 = UTC 19:00 oldingi kun
  assert.match(d, /"date_approve","<=","2026-10-29 18:59:59"/);
});
