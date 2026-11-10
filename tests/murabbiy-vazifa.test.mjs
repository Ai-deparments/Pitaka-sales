// node --test tests/murabbiy-vazifa.test.mjs — xotiradagi baza, tarmoq yo'q.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { init, taklif, ishVaqti, yarat, tekshir, belgila, eslatmalar, eslatildi, ochiqlar, qator, tugmalar, kunStat,
  xabarsizlar, xabarlandi, bekor, kochir } from "../lib/murabbiy-vazifa.mjs";
import { init as murInit } from "../lib/murabbiy.mjs";

const tk = (y, m, d, hh, mm = 0) => Date.UTC(y, m - 1, d, hh - 5, mm);    // Toshkent devor soati → ms
const NOW = tk(2026, 10, 27, 10, 0);                                       // seshanba 10:00
const hm = (ms) => new Date(ms + 5 * 3600e3).toISOString().slice(0, 16);

function baza() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, login TEXT, name TEXT, role TEXT)");
  db.exec("INSERT INTO users VALUES (7,'a','Ali','menejer')");
  murInit(db); init(db);
  return db;
}
let n = 0;
const qo = (db, o = {}) => {
  const c = { call_id: "c" + ++n, owner: "14", at: new Date(NOW - 60e3).toISOString(), dur: 95, out: 1, title: "Aziz uyi", kind: "deal", eid: "100", ...o };
  db.prepare("INSERT INTO coach_calls (call_id, owner, at, dur, out, title, kind, eid) VALUES (?,?,?,?,?,?,?,?)")
    .run(c.call_id, c.owner, c.at, c.dur, c.out, c.title, c.kind, c.eid);
  return c;
};
const ARG = (db, c, a) => ({ userId: 7, owner: "14", chatId: "555", call: c, a });
const VADO = { next_action: { type: "callback", text: "Aziz bilan qayta bog'laning", owner: "operator", due: "ertaga 15:00" } };

test("taklif: next_action operator + ertaga 15:00 -> vada", () => {
  const t = taklif(VADO, { dur: 100 }, NOW);
  assert.equal(t.kind, "vada");
  assert.equal(hm(Date.parse(t.due)), "2026-10-28T15:00");
});
test("taklif: next_action yo'q, dur 95 -> qadam now+2h; dur 60 -> null", () => {
  const t = taklif({}, { dur: 95 }, NOW);
  assert.equal(t.kind, "qadam");
  assert.equal(Date.parse(t.due), NOW + 2 * 3600e3);
  assert.equal(taklif({}, { dur: 60 }, NOW), null);
  assert.equal(taklif({ next_action: "null", promises: [] }, { dur: 95 }, NOW).kind, "qadam");
});
test("taklif: mijoz nomidan next_action -> null; operator va'dasi -> vada", () => {
  assert.equal(taklif({ next_action: { text: "x", owner: "customer" } }, { dur: 200 }, NOW), null);
  const t = taklif({ promises: [{ by: "operator", type: "quote", text: "KP yuboraman", due: null }] }, { dur: 30 }, NOW);
  assert.equal(t.kind, "vada");
  assert.equal(hm(Date.parse(t.due)), "2026-10-27T18:00");          // hujjat: bugun 18:00
  const kech = taklif({ promises: [{ by: "operator", type: "quote", text: "KP", due: null }] }, { dur: 30 }, tk(2026, 10, 27, 16, 30));
  assert.equal(hm(Date.parse(kech.due)), "2026-10-28T12:00");
  const qt = taklif({ promises: [{ by: "operator", type: "callback", text: "qo'ng'iroq", due: null }] }, { dur: 30 }, NOW);
  assert.equal(hm(Date.parse(qt.due)), "2026-10-28T12:00");
});
test("taklif: yarim tunda (00:30) -> shu sananing ertalabki 11:00; yakshanba -> dushanba 11:00", () => {
  const t = taklif({}, { dur: 100 }, tk(2026, 10, 28, 0, 30));
  assert.equal(hm(Date.parse(t.due)), "2026-10-28T11:00");
  assert.equal(hm(ishVaqti(tk(2026, 10, 24, 18, 0) + 3 * 3600e3)), "2026-10-26T11:00");   // shanba 21:00 -> yakshanba 11:00 -> dushanba
  assert.equal(hm(ishVaqti(tk(2026, 10, 25, 13, 0))), "2026-10-26T11:00");
  assert.equal(hm(ishVaqti(tk(2026, 10, 27, 14, 20))), "2026-10-27T14:20");
});
test("yarat: bitta call_id ga ikkinchi chaqiruv -> null", () => {
  const db = baza(), c = qo(db);
  assert.ok(yarat(db, ARG(db, c, VADO), NOW));
  assert.equal(yarat(db, ARG(db, c, VADO), NOW + 1000), null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM coach_tasks").get().n, 1);
});
test("yarat: bir eid ga ochiq bor -> null; kuniga 7-chi -> null", () => {
  const db = baza();
  assert.ok(yarat(db, ARG(db, qo(db), VADO), NOW));
  assert.equal(yarat(db, ARG(db, qo(db), VADO), NOW), null);
  const db2 = baza();
  for (let i = 0; i < 6; i++) assert.ok(yarat(db2, ARG(db2, qo(db2, { eid: String(200 + i) }), VADO), NOW), "task " + i);
  assert.equal(yarat(db2, ARG(db2, qo(db2, { eid: "999" }), VADO), NOW), null);
});
test("yarat: panel tasks qatori", () => {
  const db = baza(), r = yarat(db, ARG(db, qo(db), VADO), NOW);
  const p = db.prepare("SELECT * FROM tasks WHERE id=?").get(r.task_id);
  assert.equal(p.assignee_id, 7); assert.equal(p.crm_id, "100"); assert.equal(p.crm_type, "deal");
  assert.equal(p.labels, '["Qo‘ng‘iroq"]'); assert.equal(p.created_by, null); assert.equal(p.due, "2026-10-28");
  assert.equal(r.chat_id, "555");
  const kp = yarat(db, ARG(db, qo(db, { eid: "101" }), { promises: [{ by: "operator", type: "document", text: "shartnoma" }] }), NOW);
  assert.equal(db.prepare("SELECT labels FROM tasks WHERE id=?").get(kp.task_id).labels, '["Hujjat"]');
});
test("yarat: telefon raqami matnga tushmaydi", () => {
  const db = baza();
  const r = yarat(db, ARG(db, qo(db), { next_action: { type: "callback", text: "+998 90 123 45 67 ga qo'ng'iroq", owner: "operator" } }), NOW);
  assert.ok(!/998/.test(r.text));
});
test("tekshir: keyingi chiquvchi >=20 s qo'ng'iroq yopadi", () => {
  const db = baza(), r = yarat(db, ARG(db, qo(db), VADO), NOW);
  qo(db, { at: new Date(NOW + 3600e3).toISOString(), dur: 15 });                       // qisqa
  qo(db, { at: new Date(NOW + 3600e3).toISOString(), dur: 60, out: 0 });               // kiruvchi
  qo(db, { at: new Date(NOW + 3600e3).toISOString(), dur: 60, owner: "99" });          // boshqa operator
  assert.equal(tekshir(db, NOW + 7200e3).length, 0);
  qo(db, { at: new Date(NOW + 3 * 3600e3).toISOString(), dur: 25 });
  const y = tekshir(db, NOW + 4 * 3600e3);
  assert.equal(y.length, 1); assert.equal(y[0].id, r.id); assert.equal(y[0].chat_id, "555");
  const row = db.prepare("SELECT * FROM coach_tasks WHERE id=?").get(r.id);
  assert.equal(row.state, "bajarildi"); assert.equal(row.closed_by, "tekshiruv");
  const p = db.prepare("SELECT col, done_at FROM tasks WHERE id=?").get(r.task_id);
  assert.equal(p.col, "bajarildi"); assert.ok(p.done_at);
});
test("tekshir: eid null -> yopilmaydi; hujjat turi yopilmaydi", () => {
  const db = baza();
  const r = yarat(db, ARG(db, qo(db, { eid: null }), VADO), NOW);
  assert.ok(r); assert.equal(r.eid, null);
  qo(db, { eid: null, at: new Date(NOW + 3600e3).toISOString() });
  const k = yarat(db, ARG(db, qo(db, { eid: "300" }), { promises: [{ by: "operator", type: "quote", text: "KP" }] }), NOW);
  qo(db, { eid: "300", at: new Date(NOW + 3600e3).toISOString() });
  assert.equal(tekshir(db, NOW + 7200e3).length, 0);
  assert.equal(belgila(db, k.id, { chatId: "555", amal: "ok" }, NOW + 7200e3).closed_by, "operator");
});
test("belgila: boshqa chat -> null; surish +1 soat; ok -> operator", () => {
  const db = baza(), r = yarat(db, ARG(db, qo(db), VADO), NOW);
  assert.equal(belgila(db, r.id, { chatId: "other", amal: "ok" }, NOW), null);
  eslatildi(db, r.id, NOW);
  const s = belgila(db, r.id, { chatId: "555", amal: "surish" }, NOW);
  assert.equal(Date.parse(s.due), Date.parse(r.due) + 3600e3 > NOW ? Math.max(Date.parse(r.due), NOW) + 3600e3 : 0);
  assert.equal(s.reminded_at, null); assert.equal(s.state, "ochiq");
  assert.equal(belgila(db, r.id, { chatId: "555", amal: "sabab", note: "mijoz telefon olmadi" }, NOW).note, "mijoz telefon olmadi");
  const o = belgila(db, r.id, { chatId: "555", amal: "ok" }, NOW);
  assert.equal(o.state, "bajarildi"); assert.equal(o.closed_by, "operator");
});
test("eslatmalar: muddat o'tgan 1 ta; eslatildi dan keyin 0, holat kechikdi", () => {
  const db = baza(), r = yarat(db, ARG(db, qo(db), VADO), NOW);
  assert.equal(eslatmalar(db, NOW).length, 0);
  const kech = Date.parse(r.due) + 60e3;
  assert.equal(eslatmalar(db, kech).length, 1);
  eslatildi(db, r.id, kech);
  assert.equal(eslatmalar(db, kech + 1e6).length, 0);
  assert.equal(db.prepare("SELECT state FROM coach_tasks WHERE id=?").get(r.id).state, "kechikdi");
  assert.equal(ochiqlar(db, 7).length, 1);
});
test("qator, tugmalar, kunStat", () => {
  const db = baza(), r = yarat(db, ARG(db, qo(db), { next_action: { text: "<b>x</b>", owner: "operator", due: "ertaga 15:00" } }), NOW);
  const q = qator(r);
  assert.match(q, /^📌 <b>Vazifa #\d+:<\/b> &lt;b&gt;x&lt;\/b&gt; · muddat 28.10 15:00$/);
  assert.equal(tugmalar(r.id).inline_keyboard[0][0].callback_data, `mv:ok:${r.id}`);
  assert.deepEqual(kunStat(db, 7, "2026-10-27"), { berildi: 1, bajarildi: 0, ochiq: 1, kechikdi: 0 });
});

// ---------------------------------------------------------------- fix round 1 (2026-11-01): xabar holati, bekor, ko'chirish
test("init: eski coach_tasks ga notified_at qo'shiladi; avval avto-yopilganlar qayta xabar qilinmaydi", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, login TEXT, name TEXT, role TEXT)");
  murInit(db);
  db.exec("DROP TABLE coach_tasks");
  db.exec(`CREATE TABLE coach_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, user_id INTEGER NOT NULL, owner TEXT NOT NULL,
    call_id TEXT UNIQUE, eid TEXT, kind TEXT, text TEXT NOT NULL, due TEXT, created_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'ochiq',
    closed_at TEXT, closed_by TEXT, evidence TEXT, reminded_at TEXT, note TEXT, chat_id TEXT)`);              // eski sxema
  db.exec(`INSERT INTO coach_tasks (user_id, owner, text, created_at, state, closed_at, closed_by) VALUES
    (7, '14', 'eski', '2026-10-26T05:00:00.000Z', 'bajarildi', '2026-10-26T07:00:00.000Z', 'tekshiruv')`);
  init(db); init(db);                                                       // idempotent
  const r = db.prepare("SELECT notified_at, closed_at FROM coach_tasks").get();
  assert.equal(r.notified_at, r.closed_at);
  assert.equal(xabarsizlar(db).length, 0);
});
test("xabarsizlar/xabarlandi: faqat tekshiruv yopgan, xabari ketmaganlar", () => {
  const db = baza(), r = yarat(db, ARG(db, qo(db), VADO), NOW);
  const k = yarat(db, ARG(db, qo(db, { eid: "301" }), VADO), NOW);
  qo(db, { at: new Date(NOW + 3600e3).toISOString(), dur: 30 });            // r lidiga keyingi qo'ng'iroq
  belgila(db, k.id, { chatId: "555", amal: "ok" }, NOW);                    // operator yopgan — xabar kerak emas
  assert.equal(tekshir(db, NOW + 7200e3).length, 1);
  assert.deepEqual(xabarsizlar(db).map((t) => t.id), [r.id]);
  xabarlandi(db, r.id, NOW + 7200e3);
  assert.equal(xabarsizlar(db).length, 0);
  assert.ok(db.prepare("SELECT notified_at FROM coach_tasks WHERE id=?").get(r.id).notified_at);
});
test("bekor: vazifa va panel qatori o'chadi — limit, berildi va eid band emas", () => {
  const db = baza(), r = yarat(db, ARG(db, qo(db), VADO), NOW);
  assert.equal(bekor(db, r.id), true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM coach_tasks").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks WHERE id=?").get(r.task_id).n, 0);
  assert.equal(kunStat(db, 7, "2026-10-27").berildi, 0);
  assert.ok(yarat(db, ARG(db, qo(db), VADO), NOW));                         // shu eid ga yana beriladi
  assert.equal(bekor(db, 99999), false);
});
test("kochir: ochiq va kechikkan vazifalar yangi chatga o'tadi, bajarilgani qoladi", () => {
  const db = baza();
  const a = yarat(db, ARG(db, qo(db, { eid: "401" }), VADO), NOW);
  const b = yarat(db, ARG(db, qo(db, { eid: "402" }), VADO), NOW);
  const c = yarat(db, ARG(db, qo(db, { eid: "403" }), VADO), NOW);
  eslatildi(db, b.id, NOW);
  belgila(db, c.id, { chatId: "555", amal: "ok" }, NOW);
  assert.equal(kochir(db, 7, "777"), 2);
  const chat = (id) => db.prepare("SELECT chat_id FROM coach_tasks WHERE id=?").get(id).chat_id;
  assert.deepEqual([chat(a.id), chat(b.id), chat(c.id)], ["777", "777", "555"]);
});

// ---------------------------------------------------------------- final fix (2026-11-02)
test("taklif: «bugun» (o'tib ketgan 10:00) tashlanadi — standart qoida; dushanba 14:30", () => {
  const du = tk(2026, 11, 2, 14, 30);
  for (const d of ["bugun", "bugun kechqurun", "bugun soat 17 da"]) {
    const t = taklif({ next_action: { type: "callback", text: "x", owner: "operator", due: d } }, { dur: 100 }, du);
    assert.ok(Date.parse(t.due) > du + 30 * 60e3, d);
    assert.equal(hm(Date.parse(t.due)), "2026-11-03T12:00", d);            // callback: ertaga 12:00
  }
  const h = taklif({ next_action: { type: "document", text: "x", owner: "operator", due: "bugun" } }, { dur: 100 }, du);
  assert.equal(hm(Date.parse(h.due)), "2026-11-02T18:00");                  // hujjat: bugun 18:00
});
test("yarat: yorliqlar — to'lov/hujjat/KP/qo'ng'iroq", () => {
  const db = baza();
  const lab = (tur, eid) => {
    const r = yarat(db, ARG(db, qo(db, { eid }), { promises: [{ by: "operator", type: tur, text: "x " + tur }] }), NOW);
    return db.prepare("SELECT labels FROM tasks WHERE id=?").get(r.task_id).labels;
  };
  assert.equal(lab("payment", "d1"), '["To‘lov"]'); assert.equal(lab("document", "d2"), '["Hujjat"]');
  assert.equal(lab("quote", "d3"), '["KP"]'); assert.equal(lab("callback", "d4"), '["Qo‘ng‘iroq"]');
});
test("panel sinxron: bajarildi ustuni → bajarildi; arxiv/o'chirish → bekor; xabarsiz; kunStat", () => {
  const db = baza();
  const a = yarat(db, ARG(db, qo(db, { eid: "p1" }), VADO), NOW);
  const b = yarat(db, ARG(db, qo(db, { eid: "p2" }), VADO), NOW);
  const c = yarat(db, ARG(db, qo(db, { eid: "p3" }), VADO), NOW);
  const d = yarat(db, ARG(db, qo(db, { eid: "p4" }), VADO), NOW);
  db.prepare("UPDATE tasks SET col='bajarildi' WHERE id=?").run(a.task_id);
  db.prepare("UPDATE tasks SET archived=1 WHERE id=?").run(b.task_id);
  db.prepare("DELETE FROM tasks WHERE id=?").run(c.task_id);
  assert.deepEqual(tekshir(db, NOW + 60e3), []);                            // Telegram xabari yo'q
  const row = (x) => db.prepare("SELECT * FROM coach_tasks WHERE id=?").get(x.id);
  assert.equal(row(a).state, "bajarildi"); assert.equal(row(a).closed_by, "panel");
  for (const x of [b, c]) { assert.equal(row(x).state, "bekor"); assert.equal(row(x).closed_by, "panel"); }
  for (const x of [a, b, c]) { assert.ok(row(x).closed_at); assert.ok(row(x).notified_at); }
  assert.equal(row(d).state, "ochiq");
  assert.equal(xabarsizlar(db).length, 0);
  assert.equal(eslatmalar(db, NOW + 3 * 864e5).filter((t) => t.id !== d.id).length, 0);
  // bekor: berildi ga kiradi, bajarildi/ochiq/kechikdi ga kirmaydi
  assert.deepEqual(kunStat(db, 7, "2026-10-27"), { berildi: 4, bajarildi: 1, ochiq: 1, kechikdi: 0 });
  // yopilgach lead band emas — shu eid ga yangi vazifa yaratiladi
  assert.ok(yarat(db, ARG(db, qo(db, { eid: "p2" }), VADO), NOW + 120e3));
});
test("kunStat: bajarildi — shu kuni yaratilganlardan (kecha yaratilib bugun yopilgani sanalmaydi)", () => {
  const db = baza();
  const kecha = yarat(db, ARG(db, qo(db, { eid: "k1" }), VADO), NOW - 864e5);
  belgila(db, kecha.id, { chatId: "555", amal: "ok" }, NOW);
  const bugun = yarat(db, ARG(db, qo(db, { eid: "k2" }), VADO), NOW);
  belgila(db, bugun.id, { chatId: "555", amal: "ok" }, NOW);
  assert.deepEqual(kunStat(db, 7, "2026-10-27"), { berildi: 1, bajarildi: 1, ochiq: 0, kechikdi: 0 });
});
