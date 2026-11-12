// node --test tests/tovar.test.mjs — eng ko'p sotilgan tovarlar (lib/tovar.mjs), sintetik bitimlar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { yigish, qurilma } from "../lib/tovar.mjs";
import { niyatKalit, javobTovar } from "../lib/rahbar.mjs";

test("qurilma: tovar nomidan model", () => {
  assert.equal(qurilma("Over The Horizon2.0-Autumn Dusk-03* Edge Case For iPhone 18 Pro Max"), "iPhone 18 Pro Max");
  assert.equal(qurilma("Edge Case for iPhone 17 Pro Black/Grey / iPhone 17 Pro / Black/Grey"), "iPhone 17 Pro");
  assert.equal(qurilma("Edge Case for iPhone Air Lucid Blue"), "iPhone Air");
  assert.equal(qurilma("17 pro max"), "iPhone 17 Pro Max");
  assert.equal(qurilma("MagEZ Case for Samsung S26 ultra"), "Samsung S26 Ultra");
  assert.equal(qurilma("Carbon Fiber Link Bracelet Band for Samsung Watch - Modern"), "Samsung Watch");
  assert.equal(qurilma("MagEZ Grip 3, Moonrise"), "Aksessuar");
  assert.equal(qurilma("Power Bank Qi2 Sunset"), "Quvvatlash");
});

test("yigish: dona va summa bo'yicha, kim va qayerda sotgani, qatorsiz bitim alohida", () => {
  const deals = [{ ID: 1, ASSIGNED_BY_ID: 10, CATEGORY_ID: 22 }, { ID: 2, ASSIGNED_BY_ID: 10, CATEGORY_ID: 22 }, { ID: 3, ASSIGNED_BY_ID: 20, CATEGORY_ID: 0 }, { ID: 4, ASSIGNED_BY_ID: 20, CATEGORY_ID: 0 }];
  const rows = [
    [{ nom: "Case A for iPhone 18 Pro", soni: 2, narx: 900000 }],
    [{ nom: "Case A for iPhone 18 Pro", soni: 1, narx: 900000 }, { nom: "MagEZ Grip 3", soni: 1, narx: 300000 }],
    [{ nom: "Case A for iPhone 18 Pro", soni: 1, narx: 850000 }, { nom: "", soni: 1, narx: 100000 }],
    null,   // tovar qatori yo'q
  ];
  const r = yigish(deals, rows, { 10: "Mohisanam", 20: "Azam" }, { 22: "B2C", 0: "Sotuv bo'limi" });
  assert.deepEqual(r.jami, { bitim: 4, qatorli: 3, qatorsiz: 1, dona: 6, summa: 3950000, tur: 3 });
  const a = r.tovarlar[0];
  assert.equal(a.nom, "Case A for iPhone 18 Pro");
  assert.deepEqual([a.soni, a.summa, a.bitim], [4, 3550000, 3]);
  assert.deepEqual(a.kim, [{ n: "Mohisanam", c: 3 }, { n: "Azam", c: 1 }]);
  assert.deepEqual(a.qayer, [{ n: "B2C", c: 3 }, { n: "Sotuv bo'limi", c: 1 }]);
  assert.ok(r.tovarlar.some((t) => t.nom === "Nomsiz tovar"));
  assert.deepEqual(r.qurilmalar[0], { nom: "iPhone 18 Pro", soni: 4, summa: 3550000 });
  // har tovar donalari yig'indisi = jami dona
  assert.equal(r.tovarlar.reduce((s, t) => s + t.soni, 0), r.jami.dona);
});

test("bot: tovar savoli uch tilda tushuniladi, «sotuv» bilan adashmaydi; javob qisqa", () => {
  assert.equal(niyatKalit("Какие товары продаются лучше всего?").niyat, "tovar");
  assert.equal(niyatKalit("qaysi tovar eng ko'p sotilyapti").niyat, "tovar");
  assert.equal(niyatKalit("энг куп сотилган махсулот").niyat, "tovar");
  assert.equal(niyatKalit("best selling products this week").niyat, "tovar");
  assert.equal(niyatKalit("сколько продаж за неделю").niyat, "sotuv");
  const out = javobTovar("ru", "Ноябрь", { tovarlar: [{ nom: "Case A", soni: 4, summa: 3550000, kim: [{ n: "Mohisanam", c: 3 }] }], qurilmalar: [{ nom: "iPhone 18 Pro", soni: 4 }], jami: { dona: 6, summa: 3950000, qatorli: 3, qatorsiz: 1 } });
  assert.match(out, /1\. Case A — <b>4<\/b> шт · 3,5 млн · Mohisanam 3/);
  assert.match(out, /Ещё 1 сделок без товаров/);
});
