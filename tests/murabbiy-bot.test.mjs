// node --test tests/murabbiy-bot.test.mjs — Murabbiy v2 bot ichida (2026-11-01): karta + vazifa, tugmalar, taymerlar, buyruqlar.
// Tarmoq yo'q: Telegram — mahalliy soxta server (har chaqiruv yoziladi), baza xotirada.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { initCallSchema } from "../lib/callstore.mjs";
import * as V from "../lib/murabbiy-vazifa.mjs";

const tk = (y, m, d, hh, mm = 0) => Date.UTC(y, m - 1, d, hh - 5, mm);   // Toshkent devor soati → ms
const SESH = (hh, mm = 0) => tk(2026, 10, 27, hh, mm);                     // seshanba
const SANA = "2026-10-27";
const iso = (ms) => new Date(ms).toISOString();
const hmTk = (isoStr) => new Date(Date.parse(isoStr) + 5 * 3600e3).toISOString().slice(11, 16);

// ---------------------------------------------------------------- soxta Telegram
const calls = [];
const xato = new Map();      // chat_id → "uz" (ulanish uziladi) | { error_code, description }
let server, M, seq = 0, mid = 100;
before(async () => {
  server = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const method = req.url.split("/").pop(), body = JSON.parse(b || "{}");
      const x = body.chat_id != null ? xato.get(String(body.chat_id)) : undefined;
      calls.push({ method, body, xato: !!x });
      if (x === "uz") { req.socket.destroy(); return; }
      res.setHeader("content-type", "application/json");
      if (x) { res.end(JSON.stringify({ ok: false, ...x })); return; }
      res.end(JSON.stringify({ ok: true, result: method === "getUpdates" ? [] : method === "sendMessage" ? { message_id: ++mid } : true }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  process.env.MURABBIY_TG_API = `http://127.0.0.1:${server.address().port}`;
  process.env.MURABBIY_BOT_TOKEN = "123456:TEST_TOKEN_not_real_xxxxxxxxxx";
  process.env.PANEL_URL = "https://panel.example";
  M = await import("../lib/murabbiy.mjs");                          // TG_API modul yuklanganda o'qiladi
});
after(() => server.close());

const yangi = async (fn) => { const n = calls.length; await fn(); return calls.slice(n); };
const sends = (cs) => cs.filter((c) => c.method === "sendMessage" && !c.xato);
const cq = (chat, data, from = chat, type = "private") => ({ callback_query: { id: `cq${++seq}`, data, from: { id: Number(from) },
  message: { message_id: 5, chat: { id: Number(chat), type } } } });
const xabar = (chat, text) => ({ message: { chat: { id: Number(chat), type: "private" }, from: { id: Number(chat) }, text } });

// ---------------------------------------------------------------- baza
function baza() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, login TEXT, role TEXT, bitrix_user_id TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by INTEGER);`);
  initCallSchema(db);
  M.init(db);
  const u = db.prepare("INSERT INTO users VALUES (?,?,?,?,?)");
  u.run(1, "Rahbar", "boss", "rahbar", null);
  u.run(2, "Ali Operator", "ali", "operator", "155");
  u.run(3, "Vali <b>&", "vali", "sotuvchi", "156");
  u.run(4, "Ulanmagan", "yoq", "operator", "157");
  const T = iso(Date.now() - 2 * 864e5);
  const l = db.prepare("INSERT INTO coach_links (user_id, chat_id, linked_at) VALUES (?,?,?)");
  l.run(1, "1001", T); l.run(2, "2002", T); l.run(3, "3003", T);
  return db;
}
const bot = (db, o = {}) => M.ishgaTushir({ db, log: () => {}, fon: false, ...o });
// bugun (Toshkent) ichidagi «hozir» — yarim tunga yaqin ishga tushsa ham kun chegarasidan chiqmaydi
const hozir = () => iso(Math.max(Date.now() - 60e3, Date.parse(`${M.bugun()}T00:00:01+05:00`)));

const TAHLIL = (o = {}) => ({
  operator_score: { total: o.score ?? 62, criteria: [
    { id: "needs", label: "Ehtiyoj", max: 20, score: 8, evidence: [] },
    { id: "nextStep", label: "Keyingi qadam", max: 10, score: 3, evidence: [{ ts: "1:05", quote: "Ertaga hisobni yuboraman" }] },
  ] },
  stats: { talkShare: { operator: 55, customer: 45 }, counts: { questions: 4, openQuestions: 2 } },
  customer: { name: "Aziz" },
  ...(o.next ? { next_action: o.next } : {}),
  ...(o.urgency ? { urgency: { level: o.urgency } } : {}),
});
// Tahlil qilingan qo'ng'iroq: call_analyses + coach_calls (callrun.qayd yo'li bilan)
function qongiroq(db, { owner = "155", at = hozir(), dur = 95, out = 1, eid = "500", id, ...o } = {}) {
  id = id || `k${++seq}`;
  const a = TAHLIL(o);
  db.prepare("INSERT INTO call_analyses (call_id, status, json, urgency, analyzed_at) VALUES (?, 'ready', ?, ?, datetime('now'))")
    .run(id, JSON.stringify(a), o.urgency || null);
  M.qayd(db, id, a, { owner, at, dur, out, entity: eid ? { title: "Aziz uyi 10 kVt", kind: "deal", id: eid } : null });
  return id;
}
const qatorOf = (db, id) => db.prepare("SELECT * FROM coach_calls WHERE call_id=?").get(id);
const vazifaOf = (db, id) => db.prepare("SELECT * FROM coach_tasks WHERE id=?").get(id);
const son = (db, t, w = "1=1") => db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${w}`).get().n;
const metaOf = (db, k) => db.prepare("SELECT v FROM coach_meta WHERE k=?").get(k)?.v ?? null;
const kutishId = (db, chat) => { const v = metaOf(db, `kutish:${chat}`); return v == null ? null : JSON.parse(v).id; };
// Vazifali karta klaviaturasi (R9): tugmalar() qatorlari + uchinchi qatorda «Panelda ochish»
function vazifaKlaviaturasi(markup, id) {
  const kb = markup.inline_keyboard, t = V.tugmalar(id).inline_keyboard;
  assert.equal(kb.length, t.length + 1);
  assert.deepEqual(kb.slice(0, t.length), t);
  assert.equal(kb.at(-1).length, 1);
  assert.equal(kb.at(-1)[0].text, "📊 Panelda ochish");
  assert.ok(kb.at(-1)[0].url.startsWith("https://panel.example/?call="));
}
// Vazifa to'g'ridan-to'g'ri (taymer testlari uchun, belgilangan vaqtda): operator Ali, «keyingi qadam» turi
function vazifaYarat(db, eid, now) {
  const id = qongiroq(db, { eid, at: iso(now - 5 * 60e3) });
  return V.yarat(db, { userId: 2, owner: "155", chatId: "2002", call: qatorOf(db, id), a: {} }, now);
}
// Karta navbati orqali vazifa (haqiqiy yo'l)
async function vazifali(db, b, o = {}) {
  qongiroq(db, o);
  await b.navbat();
  return db.prepare("SELECT * FROM coach_tasks ORDER BY id DESC LIMIT 1").get();
}

// ---------------------------------------------------------------- navbat: karta + vazifa
test("navbat: ulangan operator, keyingi qadamsiz 95 s qo'ng'iroq → bitta xabar: karta + «📌 Vazifa #» + inline tugmalar; coach_tasks 1 ta", async () => {
  const db = baza(), b = bot(db);
  const id = qongiroq(db);
  const s = sends(await yangi(() => b.navbat()));
  assert.equal(s.length, 1);
  assert.equal(s[0].body.chat_id, "2002");
  const t = db.prepare("SELECT * FROM coach_tasks").all();
  assert.equal(t.length, 1);
  assert.equal(t[0].call_id, id);
  assert.equal(t[0].user_id, 2);
  assert.equal(t[0].chat_id, "2002");
  assert.equal(t[0].kind, "qadam");
  assert.match(s[0].body.text, /^🎧 <b>Qo‘ng‘iroq tahlili<\/b>/);
  assert.ok(s[0].body.text.includes(`\n\n📌 <b>Vazifa #${t[0].id}:</b> `), s[0].body.text);
  vazifaKlaviaturasi(s[0].body.reply_markup, t[0].id);              // R9: panel havolasi yo'qolmaydi
  assert.ok(s[0].body.reply_markup.inline_keyboard.at(-1)[0].url.endsWith(`?call=${id}`));
  assert.ok(qatorOf(db, id).card_at);
  assert.equal(db.prepare("SELECT assignee_id FROM tasks WHERE id=?").get(t[0].task_id).assignee_id, 2);   // panel doskasida ham
  // keyingi sikl — ikkinchi karta ham, ikkinchi vazifa ham yo'q
  assert.equal(sends(await yangi(() => b.navbat())).length, 0);
  assert.equal(son(db, "coach_tasks"), 1);
});

test("navbat: sozlama murabbiy_vazifa=off → karta bor, vazifa yo'q", async () => {
  const db = baza(), b = bot(db);
  assert.equal(M.sozlama(db).vazifa, true);                         // standart — yoqilgan
  assert.equal(M.sozlama(db).mahorat, true);
  M.sozla(db, { vazifa: false }, 1);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='murabbiy_vazifa'").get().value, "off");
  assert.equal(M.sozlama(db).vazifa, false);
  assert.equal(M.sozlama(db).mahorat, true);
  qongiroq(db);
  const s = sends(await yangi(() => b.navbat()));
  assert.equal(s.length, 1);
  assert.match(s[0].body.text, /Qo‘ng‘iroq tahlili/);
  assert.ok(!s[0].body.text.includes("Vazifa #"));
  assert.ok(s[0].body.reply_markup.inline_keyboard[0][0].url.startsWith("https://panel.example/"));   // panel tugmasi saqlanadi
  assert.equal(son(db, "coach_tasks"), 0);
  const z = M.sozla(db, { vazifa: true, mahorat: false });
  assert.equal(z.vazifa, true);
  assert.equal(z.mahorat, false);
});

test("navbat: karta ketmaydigan qo'ng'iroqqa vazifa yo'q (qisqa, ulanmagan, «faqat kun yakuni», to'xtatgan)", async () => {
  const db = baza(), b = bot(db);
  db.prepare("UPDATE coach_links SET mode='kun' WHERE user_id=3").run();
  qongiroq(db, { dur: 50 });                                         // MIN_SEC dan qisqa
  qongiroq(db, { owner: "157", eid: "501" });                        // ulanmagan operator
  qongiroq(db, { owner: "156", eid: "502" });                        // faqat kun yakuni rejimi
  assert.equal(sends(await yangi(() => b.navbat())).length, 0);
  db.prepare("UPDATE coach_links SET paused=1 WHERE user_id=2").run();
  qongiroq(db, { dur: 200, eid: "503" });                            // to'xtatgan
  assert.equal(sends(await yangi(() => b.navbat())).length, 0);
  assert.equal(son(db, "coach_tasks"), 0);
  assert.equal(son(db, "tasks"), 0);
});

test("navbat: tarmoq uzilsa karta keyingi siklda o'sha vazifa bilan ketadi; 400/403 — yetib bormagan vazifa o'chiriladi (R11)", async () => {
  const db = baza(), b = bot(db);
  const id = qongiroq(db);
  xato.set("2002", "uz");
  try { await b.navbat(); } finally { xato.delete("2002"); }
  const t = db.prepare("SELECT * FROM coach_tasks").all();
  assert.equal(t.length, 1);
  assert.equal(qatorOf(db, id).card_at, null);                      // karta yetib bormadi — qayta urinadi, vazifa saqlanadi
  const s = sends(await yangi(() => b.navbat()));
  assert.equal(s.length, 1);
  assert.ok(s[0].body.text.includes(`📌 <b>Vazifa #${t[0].id}:</b>`));
  vazifaKlaviaturasi(s[0].body.reply_markup, t[0].id);
  assert.equal(son(db, "coach_tasks"), 1);
  const panel = son(db, "tasks");

  // 400 — karta xato bilan belgilanadi; shu siklda yaratilgan vazifa (coach_tasks + panel tasks) o'chiriladi
  const id2 = qongiroq(db, { eid: "777" });
  xato.set("2002", { error_code: 400, description: "Bad Request: chat not found" });
  try { await b.navbat(); } finally { xato.delete("2002"); }
  assert.match(qatorOf(db, id2).card_err, /chat not found/);
  assert.equal(son(db, "coach_tasks", `call_id='${id2}'`), 0);
  assert.equal(son(db, "tasks"), panel);
  assert.equal(V.kunStat(db, 2, M.bugun()).berildi, 1);              // yetib bormagani «berildi» ga kirmaydi
  // eid band qolmadi — shu lidga keyingi qo'ng'iroq vazifa oladi
  const id3 = qongiroq(db, { eid: "777" });
  assert.equal(sends(await yangi(() => b.navbat())).length, 1);
  assert.equal(son(db, "coach_tasks", `call_id='${id3}'`), 1);

  // 403 — bloklagan: to'xtatiladi, vazifa o'chiriladi
  const id4 = qongiroq(db, { eid: "778" });
  xato.set("2002", { error_code: 403, description: "Forbidden: bot was blocked by the user" });
  try { await b.navbat(); } finally { xato.delete("2002"); }
  assert.equal(db.prepare("SELECT paused FROM coach_links WHERE user_id=2").get().paused, 2);
  assert.equal(son(db, "coach_tasks", `call_id='${id4}'`), 0);
  assert.equal(son(db, "tasks"), panel + 1);
});

// ---------------------------------------------------------------- tugmalar
test("tugma mv:ok: boshqa chat / boshqa odam / guruhdan — vazifa ochiq qoladi; o'z chatidan — bajarildi, javob ✅", async () => {
  const db = baza(), b = bot(db), t = await vazifali(db, b);
  const holat = () => vazifaOf(db, t.id).state;
  let cs = await yangi(() => b.handle(cq(3003, `mv:ok:${t.id}`)));   // boshqa operator o'z chatida — begona vazifa raqami
  assert.equal(sends(cs).length, 0);
  assert.equal(cs[0].method, "answerCallbackQuery");
  assert.equal(holat(), "ochiq");
  cs = await yangi(() => b.handle(cq(2002, `mv:ok:${t.id}`, 3003)));  // operator chatida boshqa odam bosgan
  assert.equal(sends(cs).length, 0);
  assert.equal(holat(), "ochiq");
  cs = await yangi(() => b.handle(cq(2002, `mv:ok:${t.id}`, 2002, "group")));
  assert.equal(sends(cs).length, 0);
  assert.equal(holat(), "ochiq");
  cs = await yangi(() => b.handle(cq(4004, `mv:ok:${t.id}`)));        // ulanmagan chat
  assert.equal(sends(cs).length, 0);
  assert.match(cs[0].body.text, /panel orqali ulaning/);
  assert.equal(holat(), "ochiq");
  cs = await yangi(() => b.handle(cq(2002, `mv:yoq:${t.id}`)));       // soxta callback_data
  assert.equal(sends(cs).length, 0);
  assert.equal(holat(), "ochiq");

  cs = await yangi(() => b.handle(cq(2002, `mv:ok:${t.id}`)));
  assert.equal(cs[0].method, "answerCallbackQuery");
  const s = sends(cs);
  assert.equal(s.length, 1);
  assert.equal(s[0].body.chat_id, "2002");
  assert.ok(s[0].body.text.startsWith(`✅ Vazifa #${t.id} bajarildi`), s[0].body.text);
  const r = vazifaOf(db, t.id);
  assert.equal(r.state, "bajarildi");
  assert.equal(r.closed_by, "operator");
  assert.equal(db.prepare("SELECT col FROM tasks WHERE id=?").get(r.task_id).col, "bajarildi");
  cs = await yangi(() => b.handle(cq(2002, `mv:ok:${t.id}`)));        // qayta bosish — xabar yo'q
  assert.equal(sends(cs).length, 0);
  assert.match(cs[0].body.text, /allaqachon/);
});

test("tugma mv:surish: muddat +1 soat, javobda yangi muddat; begona chat sura olmaydi", async () => {
  const db = baza(), b = bot(db), t = await vazifali(db, b);
  const s = sends(await yangi(() => b.handle(cq(2002, `mv:surish:${t.id}`))));
  const r = vazifaOf(db, t.id);
  assert.ok(Date.parse(r.due) > Date.parse(t.due));
  assert.equal(r.state, "ochiq");
  assert.equal(s.length, 1);
  assert.ok(s[0].body.text.includes(`Vazifa #${t.id}`));
  assert.ok(s[0].body.text.includes(hmTk(r.due)), s[0].body.text);
  await b.handle(cq(3003, `mv:surish:${t.id}`));
  assert.equal(vazifaOf(db, t.id).due, r.due);
});

test("mv:sabab → keyingi matn izoh bo'ladi; /oxirgi yozilsa kutish bekor va buyruq ishlaydi", async () => {
  const db = baza(), b = bot(db), t = await vazifali(db, b);
  await b.handle(cq(3003, `mv:sabab:${t.id}`));                      // begona chat — kutish yo'q
  assert.equal(metaOf(db, "kutish:3003"), null);

  let s = sends(await yangi(() => b.handle(cq(2002, `mv:sabab:${t.id}`))));
  assert.equal(s.length, 1);
  assert.match(s[0].body.text, /sabab/i);
  assert.equal(kutishId(db, 2002), t.id);
  s = sends(await yangi(() => b.handle(xabar(2002, "Mijoz telefonni ko‘tarmadi <ertaga>"))));
  assert.equal(vazifaOf(db, t.id).note, "Mijoz telefonni ko‘tarmadi <ertaga>");
  assert.equal(vazifaOf(db, t.id).state, "ochiq");                  // sabab vazifani yopmaydi
  assert.equal(metaOf(db, "kutish:2002"), null);
  assert.equal(s.length, 1);
  assert.match(s[0].body.text, /saqlandi/);
  assert.ok(s[0].body.text.includes("&lt;ertaga&gt;"));

  // yana «Sabab», lekin endi buyruq yoziladi — buyruq ishlaydi, kutish bekor
  await b.handle(cq(2002, `mv:sabab:${t.id}`));
  assert.equal(kutishId(db, 2002), t.id);
  s = sends(await yangi(() => b.handle(xabar(2002, "/oxirgi"))));
  assert.equal(metaOf(db, "kutish:2002"), null);
  assert.equal(s.length, 1);
  assert.match(s[0].body.text, /Qo‘ng‘iroq tahlili/);
  s = sends(await yangi(() => b.handle(xabar(2002, "Aziz"))));     // endi oddiy matn — qidiruv, izoh emas
  assert.equal(vazifaOf(db, t.id).note, "Mijoz telefonni ko‘tarmadi <ertaga>");
  assert.ok(!/saqlandi/.test(s[0].body.text));
});

test("R10: sabab kutish 30 daqiqada eskiradi — 31 daqiqadan keyin matn qidiruvga ketadi, izoh saqlanmaydi", async () => {
  const db = baza(), b = bot(db), t = await vazifali(db, b);
  const eskir = (daqiqa) => db.prepare("UPDATE coach_meta SET v=? WHERE k='kutish:2002'")
    .run(JSON.stringify({ id: t.id, at: Date.now() - daqiqa * 60e3 }));
  await b.handle(cq(2002, `mv:sabab:${t.id}`));
  eskir(31);
  let s = sends(await yangi(() => b.handle(xabar(2002, "Aziz"))));
  assert.equal(s.length, 1);
  assert.match(s[0].body.text, /Qo‘ng‘iroq tahlili/);              // qidiruv yo'li: Aziz suhbati kartasi
  assert.equal(vazifaOf(db, t.id).note, null);
  assert.equal(metaOf(db, "kutish:2002"), null);
  // 29 daqiqa — hali kutilmoqda
  await b.handle(cq(2002, `mv:sabab:${t.id}`));
  eskir(29);
  s = sends(await yangi(() => b.handle(xabar(2002, "Mijoz o'ylab ko'radi"))));
  assert.match(s[0].body.text, /saqlandi/);
  assert.equal(vazifaOf(db, t.id).note, "Mijoz o'ylab ko'radi");
  // buzilgan qiymat — kutish yo'q deb hisoblanadi
  db.prepare("INSERT OR REPLACE INTO coach_meta (k, v) VALUES ('kutish:2002', 'buzuq')").run();
  s = sends(await yangi(() => b.handle(xabar(2002, "Aziz"))));
  assert.match(s[0].body.text, /Qo‘ng‘iroq tahlili/);
  assert.equal(vazifaOf(db, t.id).note, "Mijoz o'ylab ko'radi");
});

test("R13: qayta ulanganda ochiq/kechikkan vazifalar yangi chatga o'tadi — tugmalar ishlaydi", async () => {
  const db = baza(), b = bot(db);
  const t = await vazifali(db, b);
  const tb = await vazifali(db, b, { eid: "520" });
  const tc = await vazifali(db, b, { eid: "521" });
  V.eslatildi(db, tb.id, Date.now());                               // kechikkan
  await b.handle(cq(2002, `mv:ok:${tc.id}`));                       // bajarilgan — eski chatda qoladi
  db.prepare("INSERT INTO coach_tokens (token, user_id, expires) VALUES (?,?,?)").run("QAYTA_ULASH_tokeni_123456", 2, Date.now() + 60e3);
  await b.handle({ message: { chat: { id: 2222, type: "private" }, from: { id: 2222, first_name: "Ali" }, text: "/start QAYTA_ULASH_tokeni_123456" } });
  assert.equal(db.prepare("SELECT chat_id FROM coach_links WHERE user_id=2").get().chat_id, "2222");
  assert.equal(vazifaOf(db, t.id).chat_id, "2222");
  assert.equal(vazifaOf(db, tb.id).chat_id, "2222");
  assert.equal(vazifaOf(db, tc.id).chat_id, "2002");
  let cs = await yangi(() => b.handle(cq(2002, `mv:ok:${t.id}`)));   // eski chat — endi ulanmagan
  assert.equal(sends(cs).length, 0);
  assert.equal(vazifaOf(db, t.id).state, "ochiq");
  cs = await yangi(() => b.handle(cq(2222, `mv:ok:${t.id}`)));
  assert.ok(sends(cs)[0].body.text.startsWith(`✅ Vazifa #${t.id} bajarildi`));
  assert.equal(vazifaOf(db, t.id).state, "bajarildi");
  const v = sends(await yangi(() => b.handle(xabar(2222, "/vazifa"))))[0];
  assert.ok(v.body.text.includes(`#${tb.id}`));
});

// ---------------------------------------------------------------- vazifaTick
test("vazifaTick: avto-yopish → operatorga «✅ … bajarildi»; muddat o'tgan → bitta eslatma (ish vaqtida), ikkinchi tick'da yo'q", async () => {
  const db = baza(), b = bot(db);
  const A = vazifaYarat(db, "600", SESH(10)), B = vazifaYarat(db, "601", SESH(10));
  assert.ok(A && B);
  qongiroq(db, { eid: "600", at: iso(SESH(10, 20)), dur: 30 });     // A lidiga keyingi chiquvchi 30 s qo'ng'iroq
  let s = sends(await yangi(() => b.vazifaTick(SESH(10, 30))));
  assert.equal(s.length, 1);
  assert.equal(s[0].body.chat_id, "2002");
  assert.ok(s[0].body.text.startsWith(`✅ Vazifa #${A.id} bajarildi — `), s[0].body.text);
  assert.equal(vazifaOf(db, A.id).state, "bajarildi");
  assert.equal(vazifaOf(db, A.id).closed_by, "tekshiruv");

  // B muddati 12:00 — 19:30 da (ish vaqtidan tashqari) eslatma yo'q
  assert.equal(sends(await yangi(() => b.vazifaTick(SESH(19, 30)))).length, 0);
  assert.equal(vazifaOf(db, B.id).state, "ochiq");
  s = sends(await yangi(() => b.vazifaTick(tk(2026, 10, 28, 9, 5))));
  assert.equal(s.length, 1);
  assert.equal(s[0].body.chat_id, "2002");
  assert.ok(s[0].body.text.startsWith(`⏰ Vazifa #${B.id} muddati o'tdi: `), s[0].body.text);
  assert.deepEqual(s[0].body.reply_markup, V.tugmalar(B.id));
  assert.equal(vazifaOf(db, B.id).state, "kechikdi");
  assert.equal(sends(await yangi(() => b.vazifaTick(tk(2026, 10, 28, 9, 7)))).length, 0);
});

test("vazifaTick: avto-yopish xabari tarmoq xatosida yo'qolmaydi — keyingi tick'da ketadi; 403 — qayta urinilmaydi", async () => {
  const db = baza(), b = bot(db);
  const A = vazifaYarat(db, "620", SESH(10)), B = vazifaYarat(db, "621", SESH(10));
  qongiroq(db, { eid: "620", at: iso(SESH(10, 20)), dur: 30 });
  qongiroq(db, { eid: "621", at: iso(SESH(10, 21)), dur: 30 });
  xato.set("2002", "uz");
  let cs;
  try { cs = await yangi(() => b.vazifaTick(SESH(10, 30))); } finally { xato.delete("2002"); }
  assert.equal(sends(cs).length, 0);
  assert.equal(cs.filter((c) => c.method === "sendMessage").length, 1);   // birinchisida to'xtadi, qolgani keyingi tick'ka
  assert.equal(vazifaOf(db, A.id).state, "bajarildi");
  assert.equal(vazifaOf(db, B.id).state, "bajarildi");
  let s = sends(await yangi(() => b.vazifaTick(SESH(10, 32))));
  assert.equal(s.length, 2);
  assert.ok(s[0].body.text.startsWith(`✅ Vazifa #${A.id} bajarildi — `), s[0].body.text);
  assert.ok(s[1].body.text.startsWith(`✅ Vazifa #${B.id} bajarildi — `), s[1].body.text);
  assert.equal(sends(await yangi(() => b.vazifaTick(SESH(10, 34)))).length, 0);

  // 403: bloklagan — paused=2, xabar belgilanadi (cheksiz urinish yo'q)
  const C = vazifaYarat(db, "622", SESH(11));
  qongiroq(db, { eid: "622", at: iso(SESH(11, 20)), dur: 30 });
  xato.set("2002", { error_code: 403, description: "Forbidden: bot was blocked by the user" });
  try { await b.vazifaTick(SESH(11, 30)); } finally { xato.delete("2002"); }
  assert.equal(db.prepare("SELECT paused FROM coach_links WHERE user_id=2").get().paused, 2);
  assert.ok(vazifaOf(db, C.id).notified_at);
  db.prepare("UPDATE coach_links SET paused=0 WHERE user_id=2").run();
  assert.equal(sends(await yangi(() => b.vazifaTick(SESH(11, 32)))).length, 0);

  // to'xtatgan operatorga xabar yo'q va keyin ham ketmaydi
  const E = vazifaYarat(db, "623", SESH(12));
  qongiroq(db, { eid: "623", at: iso(SESH(12, 20)), dur: 30 });
  db.prepare("UPDATE coach_links SET paused=1 WHERE user_id=2").run();
  assert.equal(sends(await yangi(() => b.vazifaTick(SESH(12, 30)))).length, 0);
  db.prepare("UPDATE coach_links SET paused=0 WHERE user_id=2").run();
  assert.equal(sends(await yangi(() => b.vazifaTick(SESH(12, 32)))).length, 0);
  assert.equal(vazifaOf(db, E.id).state, "bajarildi");
});

test("vazifaTick: yakshanba — eslatma yo'q; to'xtatgan operatorga xabar yo'q; vazifa sozlamasi o'chiq — hech narsa", async () => {
  const db = baza(), b = bot(db);
  const t = vazifaYarat(db, "610", tk(2026, 10, 31, 10));            // shanba 10:00 → muddat 12:00
  assert.equal(sends(await yangi(() => b.vazifaTick(tk(2026, 11, 1, 10)))).length, 0);   // yakshanba
  assert.equal(vazifaOf(db, t.id).state, "ochiq");
  M.sozla(db, { vazifa: false });
  assert.equal(sends(await yangi(() => b.vazifaTick(tk(2026, 11, 2, 10)))).length, 0);
  assert.equal(vazifaOf(db, t.id).state, "ochiq");
  M.sozla(db, { vazifa: true });
  db.prepare("UPDATE coach_links SET paused=1 WHERE user_id=2").run();
  assert.equal(sends(await yangi(() => b.vazifaTick(tk(2026, 11, 2, 10)))).length, 0);   // dushanba, lekin to'xtatgan
  assert.equal(vazifaOf(db, t.id).state, "kechikdi");
});

// ---------------------------------------------------------------- mahoratTick
const toplam = (db, n = 4) => { for (let i = 0; i < n; i++) qongiroq(db, { eid: String(700 + i), at: iso(Date.now() - (i + 1) * 3600e3) }); };

test("mahoratTick: 09:30 ish kuni → xabar, 08:30 → yo'q, ikkinchi marta → yo'q", async () => {
  const db = baza(), b = bot(db);
  toplam(db);
  assert.equal(sends(await yangi(() => b.mahoratTick(SESH(8, 30)))).length, 0);
  let s = sends(await yangi(() => b.mahoratTick(SESH(9, 30))));
  assert.equal(s.length, 1);                                         // 3003 — suhbati yo'q, 1001 — CRM'siz
  assert.equal(s[0].body.chat_id, "2002");
  assert.match(s[0].body.text, /Bugungi mahorat/);
  assert.match(s[0].body.text, /Keyingi qadam/);
  assert.equal(db.prepare("SELECT crit FROM coach_focus WHERE user_id=2 AND day=?").get(SANA).crit, "nextStep");
  assert.equal(sends(await yangi(() => b.mahoratTick(SESH(9, 31)))).length, 0);
  assert.equal(sends(await yangi(() => b.mahoratTick(tk(2026, 11, 1, 9, 30)))).length, 0);   // yakshanba
  M.sozla(db, { mahorat: false });
  assert.equal(sends(await yangi(() => b.mahoratTick(tk(2026, 10, 28, 9, 30)))).length, 0);  // sozlamada o'chirilgan
  M.sozla(db, { mahorat: true });
  assert.equal(sends(await yangi(() => b.mahoratTick(tk(2026, 10, 28, 11, 30)))).length, 0); // 11:00 dan keyin
  assert.equal(sends(await yangi(() => b.mahoratTick(tk(2026, 10, 28, 10)))).length, 1);     // ertasi kuni — yana bir marta
});

test("mahoratTick (R12): tarmoq xatosi → coach_focus o'chadi, keyingi daqiqada qayta; 400 → kun ishlatilgan; 403 → paused=2", async () => {
  const db = baza(), b = bot(db);
  toplam(db);
  const fq = () => son(db, "coach_focus", `user_id=2 AND day='${SANA}'`);
  // -1 (tarmoq): qator o'chadi — keyingi daqiqada qayta urinadi
  xato.set("2002", "uz");
  try { await b.mahoratTick(SESH(9, 30)); } finally { xato.delete("2002"); }
  assert.equal(fq(), 0);
  assert.equal(sends(await yangi(() => b.mahoratTick(SESH(9, 31)))).length, 1);
  assert.equal(fq(), 1);
  // 400: qator qoladi (bugun ishlatilgan), qayta urinilmaydi
  db.prepare("DELETE FROM coach_focus").run();
  xato.set("2002", { error_code: 400, description: "Bad Request: chat not found" });
  try { await b.mahoratTick(SESH(9, 32)); } finally { xato.delete("2002"); }
  assert.equal(fq(), 1);
  assert.equal(sends(await yangi(() => b.mahoratTick(SESH(9, 33)))).length, 0);
  // 403: bloklagan — paused=2, qator qoladi
  db.prepare("DELETE FROM coach_focus").run();
  xato.set("2002", { error_code: 403, description: "Forbidden: bot was blocked by the user" });
  try { await b.mahoratTick(SESH(9, 34)); } finally { xato.delete("2002"); }
  assert.equal(db.prepare("SELECT paused FROM coach_links WHERE user_id=2").get().paused, 2);
  assert.equal(fq(), 1);
});

// ---------------------------------------------------------------- jamoa
test("jamoaTick: 18:50 → rahbar (role rahbar) chatiga jamoa xulosasi; operatorga emas; kuniga bir marta", async () => {
  const db = baza(), b = bot(db);
  const c1 = qongiroq(db, { at: iso(SESH(11)), eid: "800" });                                      // Ali, bugun
  qongiroq(db, { owner: "156", at: iso(SESH(12)), eid: "801", urgency: "critical", score: 80 });  // Vali, kritik
  qongiroq(db, { at: iso(SESH(11) - 864e5), eid: "802", urgency: "critical" });                  // kecha — sanalmaydi
  // egasi yozilmagan tahlillar (coach_calls yo'q): kun tahlil vaqti bo'yicha; urgency ustuni bo'sh bo'lsa — JSON'dan
  const yetim = db.prepare("INSERT INTO call_analyses (call_id, status, json, urgency, analyzed_at) VALUES (?, 'ready', ?, ?, ?)");
  yetim.run("y1", JSON.stringify({ urgency: { level: "critical" } }), null, "2026-10-27 08:00:00");   // bugun, JSON'da
  yetim.run("y2", "{}", "critical", "2026-10-26 08:00:00");                                         // kecha
  yetim.run("y3", "buzilgan json", null, "2026-10-27 09:00:00");                                    // buzilgan JSON — xato emas
  const vaqtsiz = qongiroq(db, { at: null, eid: "803", urgency: "critical" });                    // qo'ng'iroq vaqti noma'lum
  db.prepare("UPDATE call_analyses SET analyzed_at='2026-10-27 10:00:00' WHERE call_id=?").run(vaqtsiz);
  V.yarat(db, { userId: 2, owner: "155", chatId: "2002", call: qatorOf(db, c1), a: {} }, SESH(11, 5));
  assert.equal(sends(await yangi(() => b.jamoaTick(SESH(18, 40)))).length, 0);
  const s = sends(await yangi(() => b.jamoaTick(SESH(18, 50))));
  assert.equal(s.length, 1);
  assert.equal(s[0].body.chat_id, "1001");
  const t = s[0].body.text;
  assert.match(t, /Jamoa xulosasi/);
  assert.ok(t.includes("Ali Operator — 1 suhbat · <b>62</b> ball · vazifa 0/1 · kechikkan 0"), t);
  assert.ok(t.includes("Vali &lt;b&gt;&amp; — 1 suhbat · <b>80</b> ball · vazifa 0/0 · kechikkan 0"), t);
  assert.ok(!t.includes("<b>&"));
  assert.match(t, /ulanmagan: 1/);
  assert.match(t, /Kritik suhbatlar bugun: 3/);
  assert.equal(metaOf(db, "jamoa:1"), SANA);
  assert.equal(sends(await yangi(() => b.jamoaTick(SESH(19)))).length, 0);
  assert.equal(sends(await yangi(() => b.jamoaTick(SESH(21, 50)))).length, 0);
});

test("jamoa: faoliyat yo'q kuni — null; /jamoa: rahbar — xulosa, operator — YORDAM", async () => {
  const db = baza(), b = bot(db);
  assert.equal(M.jamoa(db, SANA), null);
  let s = sends(await yangi(() => b.handle(xabar(1001, "/jamoa"))));
  assert.match(s[0].body.text, /faoliyat yo‘q/);
  qongiroq(db);
  s = sends(await yangi(() => b.handle(xabar(1001, "/jamoa"))));
  assert.match(s[0].body.text, /Jamoa xulosasi/);
  assert.ok(s[0].body.text.includes("Ali Operator — 1 suhbat"));
  s = sends(await yangi(() => b.handle(xabar(2002, "/jamoa"))));
  assert.equal(s[0].body.text, M.YORDAM);
});

// ---------------------------------------------------------------- /sinov
test("/sinov: rahbar → karta + vazifa taklifi + mahorat, coach_tasks soni o'zgarmaydi; operator /sinov → YORDAM", async () => {
  const db = baza(), b = bot(db);
  toplam(db);
  const holat = () => [son(db, "coach_tasks"), son(db, "tasks"), son(db, "coach_focus"), son(db, "coach_calls", "card_at IS NOT NULL")].join(",");
  const oldin = holat();
  let s = sends(await yangi(() => b.handle(xabar(1001, "/sinov"))));
  assert.ok(s.length >= 1);
  assert.ok(s.every((x) => x.body.chat_id === "1001"));
  let t = s.map((x) => x.body.text).join("\n");
  assert.match(t, /Sinov/);
  assert.ok(t.includes("Ali Operator"));
  assert.match(t, /Qo‘ng‘iroq tahlili/);
  assert.match(t, /Vazifa/);
  assert.match(t, /Keyingi qadamni belgilang/);                     // taklif matni
  assert.match(t, /Bugungi mahorat/);
  assert.equal(holat(), oldin);

  s = sends(await yangi(() => b.handle(xabar(1001, "/sinov ALI"))));
  assert.ok(s.map((x) => x.body.text).join("\n").includes("Ali Operator"));
  s = sends(await yangi(() => b.handle(xabar(1001, "/sinov yoq_login"))));
  assert.equal(s.length, 1);
  assert.match(s[0].body.text, /topilmadi/);
  s = sends(await yangi(() => b.handle(xabar(1001, "/sinov vali"))));   // tahlili yo'q operator
  assert.equal(s.length, 1);
  assert.match(s[0].body.text, /tahlil/);
  assert.equal(holat(), oldin);

  s = sends(await yangi(() => b.handle(xabar(2002, "/sinov"))));
  assert.equal(s.length, 1);
  assert.equal(s[0].body.text, M.YORDAM);
  assert.equal(holat(), oldin);
  // sinovdan keyin haqiqiy mahorat xabari baribir ketadi (sinov coach_focus'ga yozmagan)
  assert.equal(sends(await yangi(() => b.mahoratTick(SESH(9, 30)))).length, 1);
});

// ---------------------------------------------------------------- /vazifa, /dars
test("/vazifa: ochiq vazifalar tugmalar bilan; yo'q bo'lsa — xabar; boshqa operatorniki ko'rinmaydi", async () => {
  const db = baza(), b = bot(db);
  let s = sends(await yangi(() => b.handle(xabar(2002, "/vazifa"))));
  assert.match(s[0].body.text, /Ochiq vazifangiz yo‘q/);
  const t = await vazifali(db, b);
  s = sends(await yangi(() => b.handle(xabar(2002, "/vazifa"))));
  assert.ok(s[0].body.text.includes(`#${t.id}`));
  const cb = s[0].body.reply_markup.inline_keyboard.flat().map((x) => x.callback_data);
  assert.ok(cb.includes(`mv:ok:${t.id}`) && cb.includes(`mv:surish:${t.id}`) && cb.includes(`mv:sabab:${t.id}`));
  s = sends(await yangi(() => b.handle(xabar(3003, "/vazifa"))));
  assert.ok(!s[0].body.text.includes(`#${t.id}`));
});

test("/dars: bo'sh — bugungi fokus mezoni; /dars e'tiroz — o'sha dars; noma'lum — mezonlar ro'yxati", async () => {
  const db = baza(), b = bot(db);
  toplam(db);
  let s = sends(await yangi(() => b.handle(xabar(2002, "/dars"))));
  assert.match(s[0].body.text, /Mini-dars: Keyingi qadam/);
  assert.doesNotMatch(s[0].body.text, /Ertaga hisobni yuboraman/);   // ball 0.3 < 0.5 — namuna sifatida ko'rsatilmaydi
  s = sends(await yangi(() => b.handle(xabar(2002, "/dars e'tiroz"))));
  assert.match(s[0].body.text, /Mini-dars: E’tiroz/);
  s = sends(await yangi(() => b.handle(xabar(2002, "/dars xyz <b>"))));
  assert.match(s[0].body.text, /topmadim/);
  assert.ok(s[0].body.text.includes("Salomlashish"));
  assert.ok(s[0].body.text.includes("xyz &lt;b&gt;"));
  s = sends(await yangi(() => b.handle(xabar(3003, "/dars"))));      // suhbati yo'q — mezon so'raladi
  assert.match(s[0].body.text, /\/dars e’tiroz/);
  s = sends(await yangi(() => b.handle(xabar(1001, "/dars yakun"))));   // CRM'siz rahbar ham darsni o'qiy oladi
  assert.match(s[0].body.text, /Mini-dars: Yakun/);
});

// ---------------------------------------------------------------- kun yakuni
test("kunYakuni: userId bilan — fokus natijasi va vazifalar qatori; userId'siz — yo'q", () => {
  const db = baza();
  const c = qongiroq(db, { at: iso(SESH(11)), eid: "950" });
  V.yarat(db, { userId: 2, owner: "155", chatId: "2002", call: qatorOf(db, c), a: {} }, SESH(11, 5));
  db.prepare("INSERT INTO coach_focus (user_id, day, crit, base, sent_at) VALUES (2, ?, 'nextStep', 0.2, ?)").run(SANA, iso(SESH(9, 1)));
  const k = M.kunYakuni(db, "155", SANA, null, { userId: 2 });
  assert.ok(k.html.includes("🎯 Fokus «Keyingi qadam»: 20% → 30% ✅"), k.html);
  assert.ok(k.html.includes("📌 Vazifalar: berildi 1 · bajarildi 0 · ochiq 1"), k.html);
  const k0 = M.kunYakuni(db, "155", SANA, null);
  assert.ok(!k0.html.includes("📌 Vazifalar"));
  assert.ok(!k0.html.includes("Fokus «"));
  // vazifa berilmagan operator — vazifa qatori yo'q
  const c3 = qongiroq(db, { owner: "156", at: iso(SESH(11)), eid: "951" });
  assert.ok(c3);
  assert.ok(!M.kunYakuni(db, "156", SANA, null, { userId: 3 }).html.includes("📌 Vazifalar"));
});

test("kunTick va /bugun: kun yakuniga vazifalar qatori qo'shiladi", async () => {
  const db = baza(), b = bot(db);
  const c = qongiroq(db, { at: iso(SESH(11)), eid: "960" });
  V.yarat(db, { userId: 2, owner: "155", chatId: "2002", call: qatorOf(db, c), a: {} }, SESH(11, 5));
  const s = sends(await yangi(() => b.kunTick(SESH(18, 35))));
  assert.equal(s.length, 1);
  assert.equal(s[0].body.chat_id, "2002");
  assert.match(s[0].body.text, /Kun yakuni/);
  assert.ok(s[0].body.text.includes("📌 Vazifalar: berildi 1"), s[0].body.text);

  const db2 = baza(), b2 = bot(db2);
  await vazifali(db2, b2);
  const s2 = sends(await yangi(() => b2.handle(xabar(2002, "/bugun"))));
  assert.ok(s2[0].body.text.includes("📌 Vazifalar: berildi 1 · bajarildi 0 · ochiq 1"), s2[0].body.text);
});

// ---------------------------------------------------------------- buyruqlar ro'yxati
test("BUYRUQ va YORDAM: yangi buyruqlar, Telegram talabiga mos", () => {
  const names = M.BUYRUQ.map((c) => c.command);
  for (const n of ["vazifa", "dars", "oxirgi", "bugun", "menyu"]) assert.ok(names.includes(n), n);
  assert.ok(M.BUYRUQ.every((c) => /^[a-z0-9_]{1,32}$/.test(c.command) && c.description.length >= 1 && c.description.length <= 256));
  for (const n of ["/vazifa", "/dars", "/jamoa", "/sinov", "/oxirgi"]) assert.ok(M.YORDAM.includes(n), n);
});

test("tugma: panelda bekor qilingan vazifa — yopilgan, holat o'zgarmaydi", async () => {
  const db = baza(), b = bot(db), t = await vazifali(db, b);
  db.prepare("UPDATE coach_tasks SET state='bekor', closed_by='panel' WHERE id=?").run(t.id);
  for (const amal of ["ok", "surish", "sabab"]) {
    const cs = await yangi(() => b.handle(cq(2002, `mv:${amal}:${t.id}`)));
    assert.equal(sends(cs).length, 0);
    assert.match(cs[0].body.text, /yopilgan/);
  }
  assert.equal(vazifaOf(db, t.id).state, "bekor");
  assert.equal(V.belgila(db, t.id, { chatId: "2002", amal: "ok" }).state, "bekor");
});
