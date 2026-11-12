// node --test tests/voronka-oylar.test.mjs — tarmoq yo'q, sintetik lidlar.
// «Oyda N lid keldi, M tasi sotib oldi»: har oy aniq son, kohorta lid yaratilgan oy bo'yicha.
import { test } from "node:test";
import assert from "node:assert/strict";
import { oyChegaralari, oylarHisob } from "../lib/voronka.mjs";

test("oyChegaralari: joriy oy bugungacha, yil almashinuvi, oy oxiri to'g'ri", () => {
  const O = oyChegaralari("2026-02-10", 3);
  assert.deepEqual(O.map((o) => [o.oy, o.from, o.to, o.joriy]), [
    ["2025-12", "2025-12-01", "2025-12-31", false],
    ["2026-01", "2026-01-01", "2026-01-31", false],
    ["2026-02", "2026-02-01", "2026-02-10", true],
  ]);
  assert.equal(O[0].nom, "Dekabr 2025");
  assert.equal(oyChegaralari("2024-03-05", 2)[0].to, "2024-02-29");   // kabisa yili
});

test("oylarHisob: lid yaratilgan oyiga yoziladi, bosqichlar ketma-ket sanaladi", () => {
  const O = oyChegaralari("2026-11-12", 2);   // oktabr, noyabr
  const L = (ID, DATE_CREATE, STATUS_ID) => ({ ID, DATE_CREATE, STATUS_ID });
  const leads = [
    L("1", "2026-10-03T10:00:00+05:00", "CONVERTED"),     // to'lov
    L("2", "2026-10-04T10:00:00+05:00", "CONVERTED"),     // bitim bekor
    L("3", "2026-10-05T10:00:00+05:00", "UC_O11I30"),     // NE KVAL — yo'qotilgan
    L("4", "2026-10-31T23:30:00+05:00", "NEW"),           // ochiq, Toshkent bo'yicha hali oktabr
    L("5", "2026-11-01T00:10:00+05:00", "UC_3D7LNB"),     // noyabr, kvalifikatsiya
    L("6", "2026-11-02T09:00:00+05:00", "CONVERTED"),     // noyabr, hisob berildi
    L("7", "2026-09-30T12:00:00+05:00", "CONVERTED"),     // oraliqdan tashqarida — sanalmaydi
  ];
  const deals = new Map([
    ["1", { ID: "d1", LEAD_ID: "1", STAGE_ID: "WON" }],
    ["2", { ID: "d2", LEAD_ID: "2", STAGE_ID: "LOSE" }],
    ["6", { ID: "d6", LEAD_ID: "6", STAGE_ID: "UC_PZILMJ" }],
    ["7", { ID: "d7", LEAD_ID: "7", STAGE_ID: "WON" }],
  ]);
  const [okt, noy] = oylarHisob(leads, deals, new Map(), O);
  assert.deepEqual(
    { lidlar: okt.lidlar, kval: okt.kval, bitim: okt.bitim, tolov: okt.tolov, yoqotilgan: okt.yoqotilgan, nekval: okt.nekval, ochiq: okt.ochiq },
    { lidlar: 4, kval: 2, bitim: 2, tolov: 1, yoqotilgan: 2, nekval: 1, ochiq: 1 });
  assert.deepEqual(
    { lidlar: noy.lidlar, kval: noy.kval, bitim: noy.bitim, tolov: noy.tolov, yoqotilgan: noy.yoqotilgan, ochiq: noy.ochiq },
    { lidlar: 2, kval: 2, bitim: 1, tolov: 0, yoqotilgan: 0, ochiq: 2 });
  // har lid aynan bitta holatda: to'lov + yo'qotilgan + ochiq = lidlar
  for (const r of [okt, noy]) assert.equal(r.tolov + r.yoqotilgan + r.ochiq, r.lidlar);
});
