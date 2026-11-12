// node --test tests/rahbar.test.mjs — tarmoq yo'q: savol → niyat/davr va javob shablonlari (sintetik sonlar).
import { test } from "node:test";
import assert from "node:assert/strict";
import { til, davr, davrNomi, niyatKalit, guruhla, javobKetgan, javobReyting, javobSotuvReyting, javob,
  xodimTop, lotin, javobXodim, javobXatolar, javobVoronka, javobYozuv } from "../lib/rahbar.mjs";

const TODAY = "2026-11-12";   // payshanba

test("niyat: egasining tipik savollari kalit so'zlar bilan tushuniladi", () => {
  const n = (s) => niyatKalit(s);
  assert.equal(n("Сколько лидов пришло в этом месяце?").niyat, "lidlar");
  assert.equal(n("Bu oy nechta lid keldi?").niyat, "lidlar");
  assert.equal(n("Сколько лидов ушло в этом месяце?").niyat, "ketgan");
  assert.equal(n("nechta lid ketdi va nega").niyat, "ketgan");
  assert.equal(n("Сколько продаж за неделю?").niyat, "sotuv");
  assert.deepEqual(n("Кто лучший по продажам?"), { niyat: "sotuv_reyting", tartib: "yaxshi" });
  assert.equal(n("кто худший по продажам").tartib, "yomon");
  assert.deepEqual(n("Какой оператор хорошо работал?"), { niyat: "reyting", tartib: "yaxshi", rol: "operator" });
  assert.equal(n("eng yomon operator kim").tartib, "yomon");
  assert.equal(n("лучший менеджер").niyat, "sotuv_reyting");
  assert.equal(n("/start").niyat, "yordam");
  assert.equal(n("как погода"), null);
});

test("davr: oy, o'tgan oy, hafta, kecha, oy nomi, N kun", () => {
  assert.deepEqual(davr("в этом месяце", TODAY), { kod: "bu_oy", from: "2026-11-01", to: "2026-11-12" });
  assert.deepEqual(davr("за прошлый месяц", TODAY), { kod: "otgan_oy", from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(davr("o'tgan oy", TODAY), { kod: "otgan_oy", from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(davr("за неделю", TODAY), { kod: "hafta", from: "2026-11-09", to: "2026-11-12" });
  assert.deepEqual(davr("прошлая неделя", TODAY), { kod: "otgan_hafta", from: "2026-11-02", to: "2026-11-08" });
  assert.deepEqual(davr("вчера", TODAY), { kod: "kecha", from: "2026-11-11", to: "2026-11-11" });
  assert.deepEqual(davr("в сентябре", TODAY), { kod: "oy_2026_9", from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(davr("в декабре", TODAY), { kod: "oy_2025_12", from: "2025-12-01", to: "2025-12-31" });   // kelajak oy — o'tgan yil
  assert.deepEqual(davr("за 7 дней", TODAY), { kod: "7_kun", from: "2026-11-06", to: "2026-11-12" });
  assert.equal(davrNomi(davr("этот месяц", TODAY), "ru"), "Ноябрь (1–12)");
  assert.equal(davrNomi(davr("o'tgan oy", TODAY), "uz"), "Oktabr 2026");
});

test("til: ruscha → ru, lotin o'zbekcha → uz", () => {
  assert.equal(til("Сколько лидов?"), "ru");
  assert.equal(til("Bu oy nechta lid keldi?"), "uz");
  assert.equal(til("Нечта лид келди, қанча?"), "uz");
});

test("ketgan: operator va sabab bo'yicha, eng ko'pi birinchi, javob qisqa", () => {
  const items = [
    { ASSIGNED_BY_ID: "1", s: "Qimmat" }, { ASSIGNED_BY_ID: "1", s: "Qimmat" }, { ASSIGNED_BY_ID: "1", s: "Hozir emas" },
    { ASSIGNED_BY_ID: "2", s: "NE KVAL" },
  ];
  const g = guruhla(items, (x) => x.s, { 1: "Azam", 2: "Husan" });
  assert.equal(g.soni, 4);
  assert.deepEqual(g.kim.map((o) => [o.ism, o.soni]), [["Azam", 3], ["Husan", 1]]);
  assert.deepEqual(g.sabab[0], { n: "Qimmat", c: 2 });
  const txt = javobKetgan("ru", "Ноябрь (1–12)", { lid: g, bitim: guruhla([], () => "") });
  assert.match(txt, /Ушло лидов: <b>4<\/b>/);
  assert.match(txt, /Azam — <b>3<\/b> \(Qimmat 2, Hozir emas 1\)/);
  assert.doesNotMatch(txt, /Сорвалось/);
  assert.ok(txt.split("\n").length <= 10);
});

test("reyting: eng yaxshi / eng yomon, kam lidli operator chiqarib tashlanadi", () => {
  const J = { operatorlar: [
    { ism: "A", yangi: 100, uzatildi: 30, ball: 70 }, { ism: "B", yangi: 100, uzatildi: 10, ball: 50 },
    { ism: "C", yangi: 5, uzatildi: 5, ball: 90 },   // 10 tadan kam lid — solishtirilmaydi
  ], menejerlar: [
    { ism: "M1", yutildi: 12, yutSumma: 45e6, ochiq: 3 }, { ism: "M2", yutildi: 2, yutSumma: 5e6, ochiq: 9 },
  ] };
  const best = javobReyting("ru", "Ноябрь", J, "yaxshi");
  assert.match(best, /1\. A — передал <b>30<\/b> из 100/);
  assert.doesNotMatch(best, /C —/);
  assert.match(javobReyting("ru", "Ноябрь", J, "yomon"), /1\. B —/);
  assert.match(javobSotuvReyting("ru", "Ноябрь", J, "yaxshi"), /1\. M1 — <b>12<\/b> прод\. · 45 млн/);
  assert.match(javobSotuvReyting("uz", "Noyabr", J, "yomon"), /1\. M2 — <b>2<\/b> ta/);
});

test("javob: tushunilmagan savol — yordam, model chaqirilmasa ham", async () => {
  const out = await javob("как погода", { today: TODAY, niyatFn: async () => null });
  assert.match(out, /Не понял вопрос/);
});

test("yangi niyatlar: lid/bitim raqami, suhbat xatolari, voronka", () => {
  assert.deepEqual(niyatKalit("что с лидом 29957"), { niyat: "yozuv", tur: "lead", id: "29957" });
  assert.deepEqual(niyatKalit("сделка #51700"), { niyat: "yozuv", tur: "deal", id: "51700" });
  assert.deepEqual(niyatKalit("29957"), { niyat: "yozuv", tur: "lead", id: "29957" });
  assert.deepEqual(niyatKalit("У кого больше всего ошибок в разговоре?"), { niyat: "xatolar", tartib: "yomon" });
  assert.equal(niyatKalit("kim suhbatni eng yaxshi qiladi, skript bo'yicha").tartib, "yaxshi");
  assert.equal(niyatKalit("Сколько дошло до оплаты?").niyat, "voronka");
  assert.equal(niyatKalit("nechtasi to'lovgacha yetdi").niyat, "voronka");
});

test("xodimTop: kirill ism lotin yoki kirillda so'ralsa topiladi, savol so'zlari ism emas", () => {
  const P = [{ id: "1", ism: "Ашрафханов Азам" }, { id: "2", ism: "Илёсов Хусан" }, { id: "3", ism: "Абдулхакимова Мохисанам" }, { id: "4", ism: "Turdibayev Firdavs" }];
  assert.equal(lotin("Ашрафханов"), "ashrafhanov");
  assert.deepEqual(xodimTop("Как работал Азам на этой неделе?", P).map((p) => p.id), ["1"]);
  assert.deepEqual(xodimTop("Azam qanday ishladi", P).map((p) => p.id), ["1"]);
  assert.deepEqual(xodimTop("Husan bu oy", P).map((p) => p.id), ["2"]);
  assert.deepEqual(xodimTop("Мохисанам сколько продала", P).map((p) => p.id), ["3"]);
  assert.deepEqual(xodimTop("Firdavs", P).map((p) => p.id), ["4"]);
  assert.deepEqual(xodimTop("Сколько лидов пришло в этом месяце?", P), []);
});

test("xodim / xatolar / voronka / yozuv javoblari qisqa va aniq sonli", () => {
  const v = { calls: 17, avgScore: 62, criteria: [
    { label: "Ochiq savollar", avgPct: 35, failed: 11, of: 17 }, { label: "E'tirozlar", avgPct: 94, failed: 1, of: 17 }] };
  const x = javobXodim("ru", "Ноябрь (1–12)", "Саидкаримов Саидахмад", { yangi: 126, uzatildi: 3, qongiroq: 584, javobPct: 74 }, { yutildi: 4, yutSumma: 4.8e6, ochiq: 710 }, v);
  assert.match(x, /передал менеджерам <b>3<\/b>/);
  assert.match(x, /Слабо: Ochiq savollar 35% \(6\/17\)/);
  assert.match(x, /Хорошо: E'tirozlar 94% \(16\/17\)/);
  const V = { managers: [{ name: "A", calls: 20, avgScore: 47, weakest: [{ label: "Tinglash", avgPct: 30 }] }, { name: "B", calls: 10, avgScore: 70, weakest: [] },
    { name: "C", calls: 1, avgScore: 10, weakest: [] }], team: { criteria: [{ label: "Tinglash", avgPct: 40 }, { label: "Salom", avgPct: 90 }] } };
  const xt = javobXatolar("ru", "Ноябрь", V, "yomon");
  assert.match(xt, /1\. A — балл <b>47<\/b> \(20 зв\.\) · слабо: Tinglash 30%/);
  assert.doesNotMatch(xt, /C —/);                   // 3 tadan kam qo'ng'iroq — reytingga kirmaydi
  assert.match(javobXatolar("ru", "Ноябрь", V, "yaxshi"), /1\. B —/);
  const vr = javobVoronka("ru", "Ноябрь", { bosqichlar: [{ nom: "Yangi lid", yetdi: 830 }, { nom: "To'lov", yetdi: 3 }], kpi: { yoqotilgan: 344, ochiq: 483 } });
  assert.match(vr, /Yangi lid: <b>830<\/b>\n↓ To'lov: <b>3<\/b> \/ 830/);
  assert.match(javobYozuv("ru", { tur: "lead", id: "29957", nom: "Jamshidbek", holat: "Yangi mijoz", masul: "Саидкаримов", sana: "2026-10-13T14:01:00", bitim: [] }), /Статус: <b>Yangi mijoz<\/b>/);
  assert.equal(javobYozuv("uz", null), "Bitrix'da topilmadi.");
});

test("mediaOf: ovoz, kruglyak, video, rasm (eng katta o'lcham), rasm-hujjat; matn — null", async () => {
  const { mediaOf } = await import("../lib/rahbar.mjs");
  assert.deepEqual(mediaOf({ voice: { file_id: "v", mime_type: "audio/ogg", file_size: 9 } }), { tur: "ovoz", id: "v", mime: "audio/ogg", size: 9 });
  assert.equal(mediaOf({ video_note: { file_id: "n" } }).tur, "video");
  assert.equal(mediaOf({ video: { file_id: "w", mime_type: "video/mp4" } }).tur, "video");
  assert.equal(mediaOf({ photo: [{ file_id: "small" }, { file_id: "big" }] }).id, "big");
  assert.equal(mediaOf({ document: { file_id: "d", mime_type: "image/png" } }).tur, "rasm");
  assert.equal(mediaOf({ document: { file_id: "p", mime_type: "application/pdf" } }), null);
  assert.equal(mediaOf({ text: "salom" }), null);
});

test("tillar: o'zbekcha kirillda, lotinda va inglizcha — davr va niyat to'g'ri (12.11: «бугун» oy bo'lib chiqqan edi)", () => {
  const q = "бугун нечта сделка болди нечпули доход опкелди";
  assert.equal(davr(q, TODAY).kod, "bugun");
  assert.equal(niyatKalit(q).niyat, "sotuv");
  assert.equal(til(q), "uz");
  assert.equal(davr("bugun nechta lid keldi", TODAY).kod, "bugun");
  assert.equal(davr("кеча нечта лид келди", TODAY).kod, "kecha");
  assert.equal(niyatKalit("кеча нечта лид келди").niyat, "lidlar");
  assert.equal(davr("utgan hafta sotuv qancha", TODAY).kod, "otgan_hafta");
  assert.equal(til("How many leads came today?"), "en");
  assert.equal(davr("How many leads came today?", TODAY).kod, "bugun");
  assert.equal(niyatKalit("How many leads came today?").niyat, "lidlar");
  assert.deepEqual(niyatKalit("who is the worst seller last month"), { niyat: "sotuv_reyting", tartib: "yomon", rol: "menejer" });
  assert.equal(davr("sales last month", TODAY).kod, "otgan_oy");
  assert.equal(niyatKalit("how many leads were lost and why").niyat, "ketgan");
  assert.deepEqual(niyatKalit("lead 29957"), { niyat: "yozuv", tur: "lead", id: "29957" });
  assert.equal(davrNomi(davr("today", TODAY), "en"), "Today");
  assert.match(javobReyting("en", "November", { operatorlar: [{ ism: "A", yangi: 100, uzatildi: 30 }] }, "yaxshi"), /handed <b>30<\/b> of 100/);
});

test("reklama savoli halol javob oladi; «leads» so'zi reklama emas; voronka javobida jami sotuv ham bor", async () => {
  assert.equal(niyatKalit("во сколько обходится одна сделка").niyat, "reklama");
  assert.equal(niyatKalit("manga bitta sdelka nechpulga aylanyapti").niyat, "reklama");
  assert.equal(niyatKalit("qaysi kreativ ishlayapti").niyat, "reklama");
  assert.equal(niyatKalit("how many leads today").niyat, "lidlar");
  assert.match(await javob("qaysi kreativ ishlayapti", { today: TODAY }), /Meta Ads/);
  const v = { bosqichlar: [{ nom: "Yangi lid", yetdi: 340 }, { nom: "To'lov", yetdi: 4 }], kpi: { yoqotilgan: 105, ochiq: 231 } };
  const out = javobVoronka("uz", "Noyabr", v, { menejerlar: [{ yutildi: 219, yutSumma: 231.2e6 }] });
  assert.match(out, /To'lov: <b>4<\/b> \/ 340/);
  assert.match(out, /jami sotuv[^\n]*<b>219<\/b> · 231,2 mln/);
});

test("«bitta sdelka qanchaga tushyapti» — reklama (narx) savoli, operatorlar reytingi emas (12.11 xatosi)", () => {
  assert.equal(niyatKalit("Bitta sdelka qanchaga tushyapti?").niyat, "reklama");
  assert.equal(niyatKalit("bitta lid nechpulga tushyapti").niyat, "reklama");
  assert.equal(niyatKalit("bugun nechta sdelka boldi").niyat, "sotuv");
});
