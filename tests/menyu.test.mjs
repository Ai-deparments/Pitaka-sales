// node --test tests/menyu.test.mjs — tarmoq yo'q, CRM yo'q: ctx soxta, Telegram — mahalliy soxta server.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import * as menyu from "../lib/menyu.mjs";

const T14 = Date.UTC(2026, 9, 29, 9, 0);   // 14:00 Toshkent
const OV = {
  openAll: 1265, active: 1200, archive: 65,
  checks: [{ id: "qadam", count: 1089 }, { id: "sana", count: 1191 }],
  owners: [{ owner: "155", ownerName: "Mirsharof B.", total: 185, clean: 20, counts: { qadam: 120, sana: 150 } },
    { owner: "14", ownerName: "Azimjon <b>&", total: 103, clean: 5, counts: { qadam: 90 } }],
};
const scopes = [];
const ctx = (o = {}) => ({
  leads: async () => ({ total: 42, rows: [] }),
  leadsScoped: async (R, scope) => { scopes.push(scope); return { total: 7 }; },
  overview: async () => OV,
  javobsiz24: async () => 251,
  plan: async () => ({ plan: 0 }),
  calls: async () => ({ totals: { calls: 1019, in: 211, out: 808, missed: 637, missedRate: 62.5 } }),
  users: async () => 22,
  ...o,
});
const RAHBAR = { role: "rahbar", owner: null };
const SOTUVCHI = { role: "sotuvchi", owner: "155" };
const OPERATOR = { role: "operator", owner: "155" };
const keys = (kb) => kb.flat().map((b) => b.callback_data).filter(Boolean);

// ---------------------------------------------------------------- klaviatura va ruxsat
test("rahbar — bo'lim tugmalari va panel havolasi, shaxsiy tugma yo'q", () => {
  const kb = menyu.klaviatura(RAHBAR, "https://panel.example");
  assert.deepEqual(keys(kb), ["m:lid_bugun", "m:lid_kecha", "m:lid_7", "m:javobsiz24", "m:ochiq", "m:qadamsiz", "m:top", "m:qongiroq"]);
  assert.equal(kb.at(-1)[0].url, "https://panel.example");
  assert.equal(menyu.klaviatura(RAHBAR, "http://panel.example").flat().some((b) => b.url), false);   // faqat https
});
test("sotuvchi — faqat o'z tugmalari; operator — bitim tugmasisiz", () => {
  const s = keys(menyu.klaviatura(SOTUVCHI));
  assert.ok(s.includes("m:mening_bitim") && s.includes("m:mening_lid_bugun") && s.includes("m:k_mezon"));
  assert.ok(!s.some((k) => ["m:lid_bugun", "m:ochiq", "m:top"].includes(k)));
  const o = keys(menyu.klaviatura(OPERATOR));
  assert.ok(!o.includes("m:mening_bitim") && o.includes("m:mening_lid_kecha"));
});
test("CRM ID'siz sotuvchi va noma'lum rol — tugma yo'q", () => {
  assert.equal(menyu.klaviatura({ role: "sotuvchi", owner: null }), null);
  assert.equal(menyu.klaviatura({ role: "mehmon", owner: "1" }), null);
});
test("callback_data barchasi 64 baytdan qisqa", () => {
  for (const k of Object.keys(menyu.TUGMA)) assert.ok(Buffer.byteLength(menyu.PREFIKS + k) <= 64);
});

// ---------------------------------------------------------------- javob
test("rahbar: bugungi lidlar — tezkor bilan, oyna va manba bilan", async () => {
  const t = await menyu.javob("lid_bugun", RAHBAR, ctx(), T14);
  assert.match(t, /42 ta lid/);
  assert.match(t, /Kesim 14:00/);
  assert.match(t, /Manba: panel/);
});
test("sotuvchi soxta tugma bilan bo'lim raqamini ololmaydi", async () => {
  for (const k of ["lid_bugun", "ochiq", "top", "qadamsiz"]) assert.equal(await menyu.javob(k, SOTUVCHI, ctx(), T14), menyu.MAN);
});
test("rahbar «mening lidlarim» ni bosa olmaydi (scope = hammasi bo'lardi)", async () => {
  assert.equal(await menyu.javob("mening_lid_bugun", RAHBAR, ctx(), T14), menyu.MAN);
});
test("sotuvchi: mening bitimlarim — faqat o'z qatori", async () => {
  const t = await menyu.javob("mening_bitim", SOTUVCHI, ctx(), T14);
  assert.match(t, /185 ta/);
  assert.match(t, /qadam belgilanmagan: 120/);
  assert.ok(!t.includes("103"));
});
test("gigiena to'liq bo'lmasa — raqam emas, XATO", async () => {
  const t = await menyu.javob("mening_bitim", SOTUVCHI, ctx({ overview: async () => ({ ...OV, active: 900, archive: 50 }) }), T14);
  assert.equal(t, menyu.XATO);
});
test("shaxsiy lidlar: sotuvchi — mas'ul, operator — op: scope", async () => {
  scopes.length = 0;
  assert.match(await menyu.javob("mening_lid_bugun", SOTUVCHI, ctx(), T14), /sizga biriktirilgan lidlar: 7 ta/);
  assert.match(await menyu.javob("mening_lid_kecha", OPERATOR, ctx(), T14), /siz ishlagan lidlar: 7 ta/);
  assert.deepEqual(scopes, ["155", "op:155"]);
});
test("CRM xatosi yoki ctx yo'q — XATO, istisno tashlanmaydi", async () => {
  assert.equal(await menyu.javob("mening_bitim", SOTUVCHI, ctx({ overview: async () => { throw new Error("CRM"); } }), T14), menyu.XATO);
  assert.equal(await menyu.javob("lid_bugun", RAHBAR, null, T14), menyu.XATO);
  assert.equal(await menyu.javob("yoq_tugma", RAHBAR, ctx(), T14), null);
});

// ---------------------------------------------------------------- Murabbiy boti: soxta Telegram server bilan
const calls = [];
let server, M, bot, db;
before(async () => {
  server = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const method = req.url.split("/").pop();
      calls.push({ method, body: JSON.parse(b || "{}") });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, result: method === "sendMessage" ? { message_id: 1 } : true }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.MURABBIY_TG_API = `http://127.0.0.1:${server.address().port}`;
  process.env.MURABBIY_BOT_TOKEN = "123456:TEST_TOKEN_not_real_xxxxxxxxxx";
  process.env.PANEL_URL = "https://panel.example";
  M = await import("../lib/murabbiy.mjs");                          // TG_API modul yuklanganda o'qiladi
  db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, login TEXT, role TEXT, bitrix_user_id TEXT)");
  db.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run(1, "Rahbar", "boss", "rahbar", null);
  db.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run(2, "Sotuvchi", "sot", "sotuvchi", "155");
  M.init(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO coach_links (user_id, chat_id, linked_at) VALUES (?,?,?)").run(1, "1001", now);
  db.prepare("INSERT INTO coach_links (user_id, chat_id, linked_at) VALUES (?,?,?)").run(2, "2002", now);
  bot = M.ishgaTushir({ db, log: () => {}, tezkorCtx: ctx(), fon: false });
});
after(() => server.close());

const cq = (chat, data, from = chat, type = "private") => ({ callback_query: { id: `cq${Math.random()}`, data, from: { id: Number(from) },
  message: { message_id: 5, chat: { id: Number(chat), type } } } });
const yangi = async (fn) => { const n = calls.length; await fn(); return calls.slice(n); };
const sends = (cs) => cs.filter((c) => c.method === "sendMessage");

test("bot: /menyu sotuvchiga faqat o'z tugmalarini yuboradi", async () => {
  const cs = await yangi(() => bot.handle({ message: { chat: { id: 2002, type: "private" }, from: { id: 2002 }, text: "/menyu" } }));
  const kb = sends(cs)[0].body.reply_markup.inline_keyboard;
  assert.ok(keys(kb).includes("m:mening_bitim"));
  assert.ok(!keys(kb).includes("m:lid_bugun"));
});
test("bot: sotuvchi tugmani bosadi — javob + yana menyu, spinner yopiladi", async () => {
  const cs = await yangi(() => bot.handle(cq(2002, "m:mening_bitim")));
  assert.equal(cs[0].method, "answerCallbackQuery");
  const s = sends(cs);
  assert.equal(s.length, 1);
  assert.match(s[0].body.text, /185 ta/);
  assert.equal(s[0].body.chat_id, "2002");
  assert.ok(s[0].body.reply_markup.inline_keyboard.length > 0);
});
test("bot: ketma-ket bosish — ikkinchisi rad, CRM'ga ikkinchi so'rov yo'q", async () => {
  const cs = await yangi(() => bot.handle(cq(2002, "m:mening_lid_bugun")));
  assert.equal(sends(cs).length, 0);
  assert.match(cs[0].body.text, /Bir soniya/);
});
test("bot: sotuvchi soxta callback_data bilan bo'lim raqamini ololmaydi", async () => {
  await new Promise((r) => setTimeout(r, 2100));
  const cs = await yangi(() => bot.handle(cq(2002, "m:top")));
  assert.match(sends(cs)[0].body.text, /🔒/);
  assert.ok(!/185|103/.test(sends(cs)[0].body.text));
});
test("bot: bog'lanmagan chat — faqat ogohlantirish, ma'lumot yo'q", async () => {
  const cs = await yangi(() => bot.handle(cq(3003, "m:lid_bugun")));
  assert.equal(sends(cs).length, 0);
  assert.match(cs[0].body.text, /panel orqali ulaning/);
});
test("bot: guruhda yoki boshqa odam bosgan tugma — hech narsa", async () => {
  let cs = await yangi(() => bot.handle(cq(1001, "m:lid_bugun", 1001, "supergroup")));
  assert.equal(sends(cs).length, 0);
  cs = await yangi(() => bot.handle(cq(1001, "m:lid_bugun", 9999)));          // chat 1001, bosgan 9999
  assert.equal(sends(cs).length, 0);
});
test("bot: rahbar — bo'lim raqami; menejer ismi HTML'da ekranlangan", async () => {
  let cs = await yangi(() => bot.handle(cq(1001, "m:lid_bugun")));
  assert.match(sends(cs)[0].body.text, /42 ta lid/);
  await new Promise((r) => setTimeout(r, 2100));
  const ov2 = { ...OV, owners: [OV.owners[1], OV.owners[0]] };                // «Azimjon <b>&» birinchi
  const b2 = M.ishgaTushir({ db, log: () => {}, tezkorCtx: ctx({ overview: async () => ov2 }), fon: false });
  cs = await yangi(() => b2.handle(cq(1001, "m:top")));
  const t = sends(cs)[0].body.text;
  assert.match(t, /Azimjon &lt;b&gt;&amp;/);
  assert.ok(!t.includes("<b>&"));
});
test("bot: buyruq tugmasi Murabbiy'ning mavjud buyrug'ini bajaradi", async () => {
  await new Promise((r) => setTimeout(r, 2100));
  const cs = await yangi(() => bot.handle(cq(2002, "m:k_mezon")));
  assert.match(sends(cs)[0].body.text, /30 kunda tahlil qilingan qo/);
});

// ---------------------------------------------------------------- ertalabki xabar (lib/ertalab.mjs) — bot ichida
const T0930 = Date.UTC(2026, 9, 27, 4, 30);   // seshanba 09:30 Toshkent
const ROWS = [
  { id: 1, title: "Uy 10 kVt", owner: "155", stage: "Taklif", amount: 12e6, currency: "UZS", idleDays: 3, issues: ["qadam"], archive: false },
  { id: 2, title: "Boshqa menejer", owner: "14", stage: "Taklif", amount: 9e6, currency: "UZS", idleDays: 1, issues: ["qadam"], archive: false },
];
test("ertalab: MURABBIY_ERTALAB yoqilmagan — hech kimga xabar yo'q", async () => {
  delete process.env.MURABBIY_ERTALAB;
  const b = M.ishgaTushir({ db, log: () => {}, tezkorCtx: ctx({ dealRows: async () => ROWS }), fon: false });
  const cs = await yangi(() => b.ertalabTick(T0930));
  assert.equal(sends(cs).length, 0);
});
test("ertalab: yoqilgan — sotuvchiga faqat o'z bitimi, kuniga bir marta; CRM xatosida belgilanmaydi", async () => {
  process.env.MURABBIY_ERTALAB = "1";
  try {
    const xato = M.ishgaTushir({ db, log: () => {}, tezkorCtx: ctx({ dealRows: async () => { throw new Error("CRM"); } }), fon: false });
    assert.equal(sends(await yangi(() => xato.ertalabTick(T0930))).length, 0);
    const b = M.ishgaTushir({ db, log: () => {}, tezkorCtx: ctx({ dealRows: async () => ROWS }), fon: false });
    const s = sends(await yangi(() => b.ertalabTick(T0930)));
    assert.equal(s.length, 1);                                         // rahbar (CRM'siz) olmaydi, sotuvchi oladi
    assert.equal(s[0].body.chat_id, "2002");
    assert.match(s[0].body.text, /Xayrli tong/);
    assert.ok(s[0].body.text.includes("Uy 10 kVt") && !s[0].body.text.includes("Boshqa menejer"));
    assert.equal(sends(await yangi(() => b.ertalabTick(T0930 + 60e3))).length, 0);   // bugun yuborilgan
  } finally { delete process.env.MURABBIY_ERTALAB; }
});

// ---------------------------------------------------------------- ko'rib chiqish topilmalari (2026-10-29)
test("meros nomlar (constructor, __proto__…) tugma emas", async () => {
  for (const k of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    assert.equal(menyu.ruxsat(k, SOTUVCHI), false, k);
    assert.equal(await menyu.javob(k, SOTUVCHI, ctx(), T14), null, k);
  }
  const jurnal = [];
  const b = M.ishgaTushir({ db, log: () => {}, audit: (...a) => jurnal.push(a), tezkorCtx: ctx(), fon: false });
  const cs = await yangi(() => b.handle(cq(2002, "m:constructor")));
  assert.equal(sends(cs).length, 0);
  assert.equal(jurnal.length, 0);                                     // auditga «tugma» bo'lib yozilmaydi
});
test("/start: menyusiz rol — yordam, «CRM'ga bog'lanmagan» emas; CRM'siz sotuvchi — ikkalasi", async () => {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run(4, "Moliya", "mol", "moliya", "77");
  db.prepare("INSERT INTO users VALUES (?,?,?,?,?)").run(5, "Yangi sotuvchi", "ys", "sotuvchi", null);
  db.prepare("INSERT INTO coach_links (user_id, chat_id, linked_at) VALUES (?,?,?)").run(4, "4004", now);
  db.prepare("INSERT INTO coach_links (user_id, chat_id, linked_at) VALUES (?,?,?)").run(5, "5005", now);
  const st = (chat) => yangi(() => bot.handle({ message: { chat: { id: chat, type: "private" }, from: { id: chat }, text: "/start" } }));
  let t = sends(await st(4004))[0].body.text;
  assert.match(t, /\/oxirgi/);
  assert.ok(!/bog‘lanmagan/.test(t));
  t = sends(await st(5005))[0].body.text;
  assert.match(t, /bog‘lanmagan/);
  assert.match(t, /\/oxirgi/);
});
test("bir chatda parallel bosish: ikkinchisi «Hisoblanmoqda», CRM bir marta, javob bitta", async () => {
  let n = 0;
  const sekin = ctx({ overview: () => { n++; return new Promise((r) => setTimeout(() => r(OV), 300)); } });
  const b = M.ishgaTushir({ db, log: () => {}, tezkorCtx: sekin, fon: false });
  const before = calls.length;
  const p1 = b.handle(cq(2002, "m:mening_bitim"));
  await new Promise((r) => setTimeout(r, 30));
  await b.handle(cq(2002, "m:mening_bitim"));
  await p1;
  const cs = calls.slice(before);
  assert.equal(n, 1);
  assert.equal(sends(cs).length, 1);
  assert.ok(cs.some((c) => c.method === "answerCallbackQuery" && /Hisoblanmoqda/.test(c.body.text || "")));
});
test("havola: rahbar/admin hisobiga havolani faqat o'zi yoki ega/CEO", () => {
  const u = (id, role) => ({ id, role });
  assert.equal(M.havolaMumkin(u(1, "rahbar"), u(1, "rahbar")), true);    // o'ziga
  assert.equal(M.havolaMumkin(u(1, "rahbar"), u(2, "sotuvchi")), true);  // jamoa a'zosiga
  assert.equal(M.havolaMumkin(u(1, "admin"), u(3, "rahbar")), false);
  assert.equal(M.havolaMumkin(u(1, "rahbar"), u(3, "admin")), false);
  assert.equal(M.havolaMumkin(u(1, "ceo"), u(3, "rahbar")), true);
  assert.equal(M.havolaMumkin(u(1, "sotuvchi"), u(2, "sotuvchi")), false);
  assert.equal(M.havolaMumkin(u(1, "rahbar"), undefined), false);
});
