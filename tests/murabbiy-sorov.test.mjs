// node --test tests/murabbiy-sorov.test.mjs — kechikkan lidlar sababi so'rovi (2026-11-02). Tarmoq yo'q: soxta Telegram, baza xotirada.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { initCallSchema } from "../lib/callstore.mjs";

const DU11 = Date.UTC(2026, 9, 26, 6, 0);          // dushanba 11:00 Toshkent (ish vaqti)
const calls = [];
const xato = new Map();
let server, M, S, mid = 500;
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
  M = await import("../lib/murabbiy.mjs");
  S = await import("../lib/murabbiy-sorov.mjs");
});
after(() => server.close());

const sends = (n0) => calls.slice(n0).filter((c) => c.method === "sendMessage" && !c.xato);
const xabar = (chat, text, reply) => ({ message: { chat: { id: Number(chat), type: "private" }, from: { id: Number(chat) }, text,
  ...(reply ? { reply_to_message: { message_id: reply } } : {}) } });
const iso = (ms) => new Date(ms).toISOString();

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
const bot = (db) => M.ishgaTushir({ db, log: () => {}, fon: false });
const qator = (id, owner, hours, title = `Lid ${id}`) => ({ id: String(id), title, owner, hours });
const one = (db, q, p = []) => db.prepare(q).get(...p);

test("yarat: 2 operator (biri ulangan) → 1 savol, ulanmagan ro'yxatda 1", () => {
  const db = baza();
  const r = S.yarat(db, { mavzu: "Kechikkan lidlar", by: "sarvar",
    rows: [qator(1, "155", 30), qator(2, "155", 50), qator(3, "157", 40)] }, Date.now());
  assert.equal(r.ulangan, 1);
  assert.deepEqual(r.ulanmagan, ["157"]);
  assert.equal(one(db, "SELECT COUNT(*) n FROM coach_sorov_q").n, 1);
  const q = one(db, "SELECT * FROM coach_sorov_q");
  assert.equal(q.chat_id, "2002");
  const items = JSON.parse(q.items);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "2");                 // eng uzoq kutgani birinchi
  assert.equal(S.yuboriladi(db).length, 1);
});

test("javobQabul: reply → saqlanadi; boshqa chat → false; birinchi javob g'olib", () => {
  const db = baza();
  S.yarat(db, { mavzu: "m", rows: [qator(1, "155", 30)] }, Date.now());
  const q = one(db, "SELECT id FROM coach_sorov_q");
  S.yuborildi(db, q.id, 777);
  assert.equal(S.javobQabul(db, "3003", "salom", 777, Date.now()), false);
  assert.equal(S.javobQabul(db, "2002", "mijoz telefonni ko'tarmadi", 777, Date.now()), true);
  assert.equal(one(db, "SELECT javob FROM coach_sorov_q").javob, "mijoz telefonni ko'tarmadi");
  assert.equal(S.javobQabul(db, "2002", "yana", null, Date.now()), false);
  assert.equal(one(db, "SELECT javob FROM coach_sorov_q").javob, "mijoz telefonni ko'tarmadi");
});

test("javobQabul: muddat o'tgach yoki yuborilmagan savol → false", () => {
  const db = baza();
  S.yarat(db, { mavzu: "m", rows: [qator(1, "155", 30)], muddatSoat: 1 }, Date.now());
  const q = one(db, "SELECT id FROM coach_sorov_q");
  assert.equal(S.javobQabul(db, "2002", "x", null, Date.now()), false);       // hali yuborilmagan
  S.yuborildi(db, q.id, 1);
  assert.equal(S.javobQabul(db, "2002", "x", null, Date.now() + 2 * 3600e3), false);
});

test("natija: 1 javob, 1 javobsiz → html ikkalasini ko'rsatadi, ulanmagan soni bor", () => {
  const db = baza();
  S.yarat(db, { mavzu: "Oktabr <kechikish>", rows: [qator(1, "155", 30), qator(2, "156", 40), qator(3, "157", 99), qator(4, "158", 50)] }, Date.now());
  const [a, b] = db.prepare("SELECT id, owner FROM coach_sorov_q ORDER BY id").all();
  S.yuborildi(db, a.id, 1); S.yuborildi(db, b.id, 2);
  S.javobQabul(db, "2002", "<i>band edim</i>", 1, Date.now());
  const n = S.natija(db, 1);
  assert.equal(n.javob, 1); assert.equal(n.javobsiz, 1);
  assert.match(n.html, /Ali Operator/);
  assert.match(n.html, /&lt;i&gt;band edim&lt;\/i&gt;/);
  assert.match(n.html, /Vali &lt;b&gt;&amp;/);
  assert.match(n.html, /⏳ javob bermadi/);
  assert.match(n.html, /Oktabr &lt;kechikish&gt;/);
  assert.match(n.html, /botga ulanmagan: 2 lid, 2 operator/);
  assert.ok(!/<i>band/.test(n.html));
  assert.match(n.text, /javob bermadi/);
  assert.ok(!/<b>So/.test(n.text));
});

test("handle: ochiq so'rov bo'lsa oddiy matn javob sifatida olinadi, qidiruv emas; keyingisi qidiruvga", async () => {
  const db = baza(), b = bot(db);
  S.yarat(db, { mavzu: "m", rows: [qator(1, "155", 30)] }, Date.now());
  S.yuborildi(db, one(db, "SELECT id FROM coach_sorov_q").id, 9);
  let n0 = calls.length;
  await b.handle(xabar(2002, "Aziz"));
  const s = sends(n0);
  assert.equal(s.length, 1);
  assert.match(s[0].body.text, /Javobingiz qabul qilindi/);
  assert.equal(one(db, "SELECT javob FROM coach_sorov_q").javob, "Aziz");
  n0 = calls.length;
  await b.handle(xabar(2002, "Aziz"));
  assert.match(sends(n0)[0].body.text, /Topilmadi/);                      // qidiruv
});

test("handle: sabab kutilayotgan bo'lsa u ustun; buyruq so'rov javobi emas", async () => {
  const db = baza(), b = bot(db);
  S.yarat(db, { mavzu: "m", rows: [qator(1, "155", 30)] }, Date.now());
  S.yuborildi(db, one(db, "SELECT id FROM coach_sorov_q").id, 9);
  await b.handle(xabar(2002, "/yordam"));
  assert.equal(one(db, "SELECT javob FROM coach_sorov_q").javob, null);
  db.prepare("INSERT INTO coach_meta (k,v) VALUES (?,?)").run("kutish:2002", JSON.stringify({ id: 99, at: Date.now() }));
  const n0 = calls.length;
  await b.handle(xabar(2002, "sabab"));
  assert.equal(one(db, "SELECT javob FROM coach_sorov_q").javob, null);
  assert.ok(!/Javobingiz qabul/.test(sends(n0)[0].body.text));
});

test("sorovTick: savol yuboriladi (≤10 qator, yana N ta, telefon yashirin), msg_id saqlanadi, qayta yo'q", async () => {
  const db = baza(), b = bot(db);
  const rows = Array.from({ length: 13 }, (_, i) => qator(i + 1, "155", 20 + i, i === 12 ? "Aziz +998 90 123 45 67 <x>" : `Lid ${i + 1}`));
  S.yarat(db, { mavzu: "Test", rows }, DU11);
  const n0 = calls.length;
  await b.sorovTick(DU11);
  const s = sends(n0);
  assert.equal(s.length, 1);
  assert.equal(s[0].body.chat_id, "2002");
  const t = s[0].body.text;
  assert.match(t, /…va yana 3 ta/);
  assert.match(t, /Har biri bo'yicha qisqa sabab yozing \(bitta xabarda\)\. Javobni shu chatga yozing\./);
  assert.ok(!/998/.test(t));
  assert.equal((t.match(/^\d+\. /gm) || []).length, 10);
  assert.ok(one(db, "SELECT msg_id FROM coach_sorov_q").msg_id > 0);
  const n1 = calls.length;
  await b.sorovTick(DU11);
  assert.equal(sends(n1).length, 0);
});

test("sorovTick: tarmoq xatosi → keyingi tickda qayta; 403 → paused=2", async () => {
  const db = baza(), b = bot(db);
  S.yarat(db, { mavzu: "m", rows: [qator(1, "155", 30), qator(2, "156", 30)] }, DU11);
  xato.set("2002", "uz");
  await b.sorovTick(DU11);
  assert.equal(one(db, "SELECT sent_at FROM coach_sorov_q WHERE chat_id='2002'").sent_at, null);
  xato.delete("2002");
  xato.set("3003", { error_code: 403, description: "blocked" });
  const n0 = calls.length;
  await b.sorovTick(DU11);
  xato.delete("3003");
  assert.equal(one(db, "SELECT paused FROM coach_links WHERE user_id=3").paused, 2);
  assert.ok(sends(n0).some((c) => c.body.chat_id === "2002"));
});

test("sorovTick: muddat o'tdi → rahbarga 1 xulosa, qayta yo'q", async () => {
  const db = baza(), b = bot(db);
  const t0 = DU11;
  S.yarat(db, { mavzu: "Xulosa", rows: [qator(1, "155", 30)], muddatSoat: 1 }, t0);
  await b.sorovTick(t0);                                                  // savol ketdi
  let n0 = calls.length;
  await b.sorovTick(t0 + 30 * 60e3);
  assert.equal(sends(n0).length, 0);                                      // muddat hali o'tmadi
  n0 = calls.length;
  await b.sorovTick(t0 + 2 * 3600e3);
  const s = sends(n0);
  assert.equal(s.length, 1);
  assert.equal(s[0].body.chat_id, "1001");
  assert.match(s[0].body.text, /javob bermadi/);
  assert.ok(one(db, "SELECT xulosa_at FROM coach_sorov").xulosa_at);
  n0 = calls.length;
  await b.sorovTick(t0 + 3 * 3600e3);
  assert.equal(sends(n0).length, 0);
});

test("CLI mantig'i: kechikkan() chop etiladigan matn, natijaMatn(), holatMatn()", () => {
  const db = baza();
  const r = S.kechikkan(db, { rows: [qator(1, "155", 30), qator(3, "157", 40)], soat: 4, by: "cli" }, Date.now());
  assert.match(r, /So'rov #1/);
  assert.match(r, /ulangan: 1 operator/);
  assert.match(r, /ulanmagan: 1 operator/);
  assert.match(S.natijaMatn(db), /Ali Operator/);
  assert.equal(S.natijaMatn(db, 99), "So'rov #99 topilmadi.");
  const now = Date.now();
  const T = db.prepare(`INSERT INTO coach_tasks (user_id, owner, text, created_at, state, closed_by) VALUES (?,?,?,?,?,?)`);
  T.run(2, "155", "a", iso(now - 864e5), "bajarildi", "tekshiruv");
  T.run(2, "155", "b", iso(now - 864e5), "bajarildi", "operator");
  T.run(2, "155", "c", iso(now - 864e5), "ochiq", null);
  T.run(2, "155", "d", iso(now - 864e5), "kechikdi", null);
  T.run(3, "156", "e", iso(now - 30 * 864e5), "ochiq", null);
  const h = S.holatMatn(db, 7, now);
  assert.match(h, /Ali Operator: berildi 4, bajarildi 2 \(tekshiruv 1, operator 1\), ochiq 1, kechikkan 1/);
  assert.ok(!/Vali/.test(h));
});

test("natija: 15 operator, uzun javoblar → html < 4096 va «va yana» qatori; CLI matni to'liq", () => {
  const db = baza();
  const u = db.prepare("INSERT INTO users VALUES (?,?,?,?,?)"), l = db.prepare("INSERT INTO coach_links (user_id, chat_id, linked_at) VALUES (?,?,?)");
  const rows = [];
  for (let i = 0; i < 15; i++) { u.run(100 + i, `Operator ${i}`, `op${i}`, "operator", `9${i}`); l.run(100 + i, `${5000 + i}`, iso(Date.now())); rows.push(qator(i + 1, `9${i}`, 30)); }
  S.yarat(db, { mavzu: "Katta", rows }, Date.now());
  for (const q of db.prepare("SELECT id, chat_id FROM coach_sorov_q").all()) {
    S.yuborildi(db, q.id, q.id);
    S.javobQabul(db, q.chat_id, "<&>".repeat(150), null, Date.now());     // escape uzunlikni oshiradi
  }
  const n = S.natija(db, 1);
  assert.ok(n.html.length < 4096, `uzunlik ${n.html.length}`);
  assert.match(n.html, /…va yana \d+ ta operator \(to'liq: CLI natija #1\)/);
  assert.equal((n.text.match(/^- /gm) || []).length, 15);
  assert.ok(n.text.includes("<&>".repeat(150)));
});

test("R14: rahbar ulanmagan bo'lsa xulosa kutadi (xulosa_at NULL); rahbar ulangach bir marta ketadi", async () => {
  const db = baza(), b = bot(db);
  db.prepare("UPDATE coach_links SET paused=1 WHERE user_id=1").run();
  const t0 = DU11;
  S.yarat(db, { mavzu: "R14", rows: [qator(1, "155", 30)], muddatSoat: 1 }, t0);
  await b.sorovTick(t0);
  let n0 = calls.length;
  await b.sorovTick(t0 + 2 * 3600e3);
  assert.equal(sends(n0).length, 0);
  assert.equal(one(db, "SELECT xulosa_at FROM coach_sorov").xulosa_at, null);
  db.prepare("UPDATE coach_links SET paused=0 WHERE user_id=1").run();
  n0 = calls.length;
  await b.sorovTick(t0 + 3 * 3600e3);
  assert.equal(sends(n0).length, 1);
  assert.ok(one(db, "SELECT xulosa_at FROM coach_sorov").xulosa_at);
  n0 = calls.length;
  await b.sorovTick(t0 + 4 * 3600e3);
  assert.equal(sends(n0).length, 0);
});

test("R15: owner '?' yoki bo'sh → mas'ulsiz lid, ulanmagan operator emas", () => {
  const db = baza();
  const r = S.yarat(db, { mavzu: "m", rows: [qator(1, "155", 30), qator(2, "?", 40), qator(3, "", 50), qator(4, "157", 20)] }, Date.now());
  assert.deepEqual(r.ulanmagan, ["157"]);
  assert.equal(r.masulsiz, 2);
  const n = S.natija(db, r.id);
  assert.match(n.html, /botga ulanmagan: 1 lid, 1 operator/);
  assert.match(n.html, /mas'ulsiz: 2 lid/);
  assert.match(n.text, /mas'ulsiz: 2 lid/);
  assert.match(S.kechikkan(db, { rows: [qator(2, "?", 40)], soat: 4 }, Date.now()), /Mas'ulsiz: 1 lid/);
});

test("sorovTick: yakshanba va kechki 22:00 da hech narsa ketmaydi; ish vaqtidagi tickda ketadi (savol va xulosa)", async () => {
  const db = baza(), b = bot(db);
  S.yarat(db, { mavzu: "Ish vaqti", rows: [qator(1, "155", 30)], muddatSoat: 1 }, DU11);
  const yak = Date.UTC(2026, 9, 25, 6, 0), kech = Date.UTC(2026, 9, 26, 17, 0);   // yakshanba 11:00; dushanba 22:00
  let n0 = calls.length;
  await b.sorovTick(yak); await b.sorovTick(kech);
  assert.equal(sends(n0).length, 0);
  assert.equal(one(db, "SELECT sent_at FROM coach_sorov_q").sent_at, null);
  await b.sorovTick(DU11);                                                 // savol ketdi
  n0 = calls.length;
  await b.sorovTick(Date.UTC(2026, 9, 26, 17, 30));                         // muddat o'tgan, lekin 22:30 — xulosa yo'q
  assert.equal(sends(n0).length, 0);
  assert.equal(one(db, "SELECT xulosa_at FROM coach_sorov").xulosa_at, null);
  await b.sorovTick(Date.UTC(2026, 9, 27, 5, 0));                           // seshanba 10:00 — xulosa ketdi
  assert.equal(sends(n0).length, 1);
  assert.ok(one(db, "SELECT xulosa_at FROM coach_sorov").xulosa_at);
});

test("yuborildi: qayta ulangan chatga ketsa, chat_id yangilanadi va javob qabul qilinadi", async () => {
  const db = baza(), b = bot(db);
  S.yarat(db, { mavzu: "Relink", rows: [qator(1, "155", 30)] }, DU11);
  db.prepare("UPDATE coach_links SET chat_id='9009' WHERE user_id=2").run();   // yaratilgandan keyin qayta ulandi
  await b.sorovTick(DU11);
  assert.equal(one(db, "SELECT chat_id FROM coach_sorov_q").chat_id, "9009");
  assert.equal(S.javobQabul(db, "9009", "mijoz javob bermadi", null, DU11 + 60e3), true);
});

test("yarat: ish vaqtidan tashqarida — muddat keyingi 09:00 + soat; savol va xulosa o'sha oynadan", async () => {
  const yak10 = Date.UTC(2026, 9, 25, 5, 0), du20 = Date.UTC(2026, 9, 26, 15, 0);   // yakshanba 10:00; dushanba 20:00 Toshkent
  const du9 = Date.UTC(2026, 9, 26, 4, 0), se9 = Date.UTC(2026, 9, 27, 4, 0);       // dushanba 09:00; seshanba 09:00
  for (const [t0, bosh, soatTick] of [[yak10, du9, "dushanba"], [du20, se9, "ertaga"]]) {
    const db = baza(), b = bot(db);
    const matn = S.kechikkan(db, { rows: [qator(1, "155", 30)], soat: 4 }, t0);
    assert.match(matn, new RegExp(`Ish vaqtidan tashqari .*${new Date(bosh + 5 * 3600e3).toISOString().slice(0, 10)} 09:00`));
    assert.equal(Date.parse(one(db, "SELECT muddat FROM coach_sorov").muddat), bosh + 4 * 3600e3, soatTick);
    let n0 = calls.length;
    await b.sorovTick(t0); await b.sorovTick(bosh - 60e3);
    assert.equal(sends(n0).length, 0);
    await b.sorovTick(bosh);                                               // 09:00 — savol ketdi
    assert.equal(sends(n0).length, 1);
    n0 = calls.length;
    await b.sorovTick(bosh + 3 * 3600e3);                                  // muddatdan oldin — xulosa yo'q
    assert.equal(sends(n0).length, 0);
    await b.sorovTick(bosh + 4 * 3600e3 + 60e3);
    assert.equal(sends(n0).length, 1);
  }
  const db = baza();
  assert.match(S.kechikkan(db, { rows: [qator(1, "155", 30)], soat: 4 }, DU11), /1 daqiqada yuboradi \(hozir\)/);
});
