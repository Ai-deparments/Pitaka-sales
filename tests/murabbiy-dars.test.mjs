// node --test tests/murabbiy-dars.test.mjs — tarmoq yo'q, baza xotirada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { init as coachInit, QISQA, MASLAHAT } from "../lib/murabbiy.mjs";
import { initCallSchema } from "../lib/callstore.mjs";
import { init, fokus, iqtibos, mahorat, natija, dars, mezonTop, DARS } from "../lib/murabbiy-dars.mjs";
import * as D from "../lib/murabbiy-dars.mjs";

const baza = () => { const db = new DatabaseSync(":memory:"); coachInit(db); initCallSchema(db); init(db); return db; };
const SANA = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);   // bugun (Toshkent)
const kunMs = (sana, hh = 12) => Date.parse(`${sana}T00:00:00+05:00`) + hh * 3600e3;
let seq = 0;
function qo(db, { owner = "14", at = new Date().toISOString(), dur = 120, score = 50, crit = {}, id } = {}) {
  id = id || `c${++seq}`;
  db.prepare("INSERT INTO coach_calls(call_id, owner, at, dur, score, crit) VALUES (?,?,?,?,?,?)")
    .run(id, String(owner), at, dur, score, JSON.stringify(crit));
  return id;
}
function tahlil(db, id, evidence) {
  const j = { operator_score: { criteria: [{ id: "nextStep", label: "x", max: 10, score: 9, evidence, tip: null }] } };
  db.prepare("INSERT INTO call_analyses(call_id, status, json) VALUES (?, 'ready', ?)").run(id, JSON.stringify(j));
}
const vaqt = (i) => new Date(Date.now() - i * 3600e3).toISOString();

test("QISQA va MASLAHAT murabbiy.mjs orqali ham eksport qilinadi", () => {
  assert.equal(QISQA, D.QISQA);
  assert.equal(MASLAHAT, D.MASLAHAT);
});

test("fokus: eng past mezon tanlanadi; 2 ta qo'ng'iroqda null", () => {
  const db = baza();
  qo(db, { owner: "7", at: vaqt(1), crit: { needs: 0.9, nextStep: 0.2, closing: 0.5 } });
  assert.equal(fokus(db, "7"), null);
  qo(db, { owner: "7", at: vaqt(2), crit: { needs: 0.8, nextStep: 0.4, closing: 0.5 } });
  assert.equal(fokus(db, "7"), null);                       // 2 ta — kam
  qo(db, { owner: "7", at: vaqt(3), crit: { needs: 0.7, nextStep: 0.3, closing: 0.5 } });
  const f = fokus(db, "7");
  assert.equal(f.crit, "nextStep");
  assert.equal(f.n, 3);
  assert.ok(Math.abs(f.p - 0.3) < 1e-9);
});

test("fokus: qisqa (<60 s) va balsiz qo'ng'iroqlar sanalmaydi; teng bo'lsa vazni katta", () => {
  const db = baza();
  for (let i = 1; i <= 3; i++) qo(db, { at: vaqt(i), crit: { closing: 0.5, needs: 0.5 } });   // needs vazni 20 > closing 5
  qo(db, { at: vaqt(5), dur: 30, crit: { closing: 0 } });
  qo(db, { at: vaqt(6), score: null, crit: { closing: 0 } });
  const f = fokus(db, "14");
  assert.equal(f.n, 3);
  assert.equal(f.crit, "needs");
});

test("iqtibos: eng yuqori balli suhbatdan iqtibos, 140 dan uzun kesiladi", () => {
  const db = baza();
  const a = qo(db, { at: vaqt(1), crit: { nextStep: 0.3 } });
  const b = qo(db, { at: vaqt(2), crit: { nextStep: 0.9 } });
  tahlil(db, a, [{ line: 1, ts: "0:10", quote: "past" }]);
  tahlil(db, b, [{ line: 4, ts: "1:05", quote: "x".repeat(300) }]);
  const q = iqtibos(db, "14", "nextStep");
  assert.equal(q.callId, b);
  assert.equal(q.ts, "1:05");
  assert.ok(q.quote.length <= 140);
  assert.ok(q.quote.startsWith("xxx"));
  assert.equal(iqtibos(db, "14", "closing"), null);
  assert.equal(iqtibos(db, "99", "nextStep"), null);
});

test("mahorat: coach_focus ga yoziladi, ikkinchi chaqiruvda null (kuniga 1)", () => {
  const db = baza();
  for (let i = 1; i <= 4; i++) qo(db, { at: vaqt(i + 30), crit: { needs: 0.8, nextStep: 0.25 } });
  const id = qo(db, { at: vaqt(40), crit: { needs: 0.8, nextStep: 0.9 } });
  tahlil(db, id, [{ line: 2, ts: "0:20", quote: "Ertaga soat 11 da <yuboraman> & \"ok\"" }]);
  const m = mahorat(db, { userId: 5, owner: "14" }, SANA);
  assert.ok(m);
  assert.equal(m.crit, "nextStep");
  assert.ok(m.base > 0.2 && m.base < 0.6);
  assert.match(m.html, /Bugungi mahorat/);
  assert.match(m.html, /Keyingi qadam/);
  assert.match(m.html, /Maqsad/);
  assert.match(m.html, /%/);
  assert.ok(m.html.includes("&lt;yuboraman&gt;"));          // iqtibos escape qilingan
  assert.ok(!m.html.includes("<yuboraman>"));
  const row = db.prepare("SELECT * FROM coach_focus WHERE user_id=5 AND day=?").get(SANA);
  assert.equal(row.crit, "nextStep");
  assert.equal(row.base, m.base);
  assert.ok(row.sent_at);
  assert.equal(mahorat(db, { userId: 5, owner: "14" }, SANA), null);
});

test("mahorat: ma'lumot kam bo'lsa null va yozuv yo'q", () => {
  const db = baza();
  qo(db, { crit: { needs: 0.5 } });
  assert.equal(mahorat(db, { userId: 5, owner: "14" }, SANA), null);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM coach_focus").get().c, 0);
});

test("natija: base 0.4, bugun 0.65 → «40% → 65% ✅»", () => {
  const db = baza();
  db.prepare("INSERT INTO coach_focus(user_id, day, crit, base, sent_at) VALUES (5, ?, 'nextStep', 0.4, 'x')").run(SANA);
  qo(db, { at: new Date(kunMs(SANA, 10)).toISOString(), crit: { nextStep: 0.6 } });
  qo(db, { at: new Date(kunMs(SANA, 11)).toISOString(), crit: { nextStep: 0.7 } });
  qo(db, { at: new Date(kunMs(SANA, 11)).toISOString(), dur: 20, crit: { nextStep: 0 } });   // qisqa — sanalmaydi
  const s = natija(db, 5, "14", SANA);
  assert.equal(s, "🎯 Fokus «Keyingi qadam»: 40% → 65% ✅");
});

test("natija: ➖, ⚠️ va null holatlari", () => {
  const db = baza();
  db.prepare("INSERT INTO coach_focus(user_id, day, crit, base) VALUES (5, ?, 'needs', 0.5)").run(SANA);
  assert.equal(natija(db, 5, "14", SANA), null);             // bugun suhbat yo'q
  assert.equal(natija(db, 6, "14", SANA), null);             // fokus yo'q
  const id = qo(db, { at: new Date(kunMs(SANA, 10)).toISOString(), crit: { needs: 0.52 } });
  assert.match(natija(db, 5, "14", SANA), /50% → 52% ➖/);
  db.prepare("UPDATE coach_calls SET crit=? WHERE call_id=?").run(JSON.stringify({ needs: 0.3 }), id);
  assert.match(natija(db, 5, "14", SANA), /50% → 30% ⚠️/);
  // boshqa kun (Toshkent chegarasi): 23:30 Toshkent kechagi kun
  const db2 = baza();
  db2.prepare("INSERT INTO coach_focus(user_id, day, crit, base) VALUES (5, ?, 'needs', 0.5)").run(SANA);
  qo(db2, { at: new Date(kunMs(SANA, 0) - 30 * 60e3).toISOString(), crit: { needs: 1 } });
  assert.equal(natija(db2, 5, "14", SANA), null);
});

test("dars('nextStep') ✅ va ❌ namunani o'z ichiga oladi; hamma 8 mezon bor", () => {
  const h = dars("nextStep");
  assert.match(h, /✅/);
  assert.match(h, /❌/);
  assert.match(h, /Keyingi qadam/);
  assert.equal(Object.keys(DARS).length, 8);
  for (const id of Object.keys(QISQA)) assert.ok(dars(id).includes("✅") && dars(id).includes("❌"), id);
  assert.equal(dars("nope"), null);
  const q = dars("nextStep", { quote: "<b>x</b> & y" });
  assert.ok(q.includes("&lt;b&gt;x&lt;/b&gt; &amp; y"));
  assert.ok(!q.includes("<b>x</b>"));
});

test("mezonTop: lotin, kirill, variantlar", () => {
  assert.equal(mezonTop("keyingi qadam"), "nextStep");
  assert.equal(mezonTop("qadam"), "nextStep");
  assert.equal(mezonTop("xyz"), null);
  assert.equal(mezonTop(""), null);
  assert.equal(mezonTop(undefined), null);
  for (const t of ["e'tiroz", "etiroz", "эътироз", "E’tiroz", "eʼtiroz", "e`tiroz", "e‘tiroz"]) assert.equal(mezonTop(t), "objection", t);
  assert.equal(mezonTop("салом"), "greeting");
  assert.equal(mezonTop("salom"), "greeting");
  assert.equal(mezonTop("ehtiyoj"), "needs");
  assert.equal(mezonTop("эҳтиёж"), "needs");
  assert.equal(mezonTop("savol"), "questions");
  assert.equal(mezonTop("tinglash"), "listening");
  assert.equal(mezonTop("qiymat"), "value");
  assert.equal(mezonTop("yakun"), "closing");
  assert.equal(mezonTop("  Кейинги қадам "), "nextStep");
  assert.equal(mezonTop("nextStep"), "nextStep");
});

function tahlilC(db, id, crit, evidence) {
  const j = { operator_score: { criteria: [{ id: crit, label: "x", max: 10, score: 9, evidence, tip: null }] } };
  db.prepare("INSERT INTO call_analyses(call_id, status, json) VALUES (?, 'ready', ?)").run(id, JSON.stringify(j));
}

test("iqtibos: tinglash uchun doim null (gap bo'lish dalili)", () => {
  const db = baza();
  const a = qo(db, { at: vaqt(1), crit: { listening: 0.8 } });
  tahlilC(db, a, "listening", [{ line: 3, ts: "0:20", quote: "kutib turing", by: "operator" }]);
  assert.equal(iqtibos(db, "14", "listening"), null);
});

test("iqtibos: gapiruvchisi operator bo'lmagan dalil o'tkazib yuboriladi; boshqa suhbatdagi operator iqtibosi olinadi", () => {
  const db = baza();
  const a = qo(db, { at: vaqt(1), crit: { objection: 0.9 } });
  const b = qo(db, { at: vaqt(2), crit: { objection: 0.6 } });
  tahlilC(db, a, "objection", [{ line: 2, ts: "0:10", quote: "Qimmat ekan", by: "customer" }]);
  tahlilC(db, b, "objection", [{ line: 5, ts: "1:10", quote: "Kafolat 5 yil" }]);
  assert.equal(iqtibos(db, "14", "objection").quote, "Kafolat 5 yil");
  const db2 = baza();
  const c = qo(db2, { at: vaqt(1), crit: { objection: 0.9 } });
  tahlilC(db2, c, "objection", [{ line: 2, quote: "Qimmat ekan", speaker: "customer" }]);
  assert.equal(iqtibos(db2, "14", "objection"), null);
});

test("iqtibos: telefon raqami yashiriladi; balli 0.5 dan past suhbat ishlatilmaydi", () => {
  const db = baza();
  const a = qo(db, { at: vaqt(1), crit: { nextStep: 0.9 } });
  tahlil(db, a, [{ line: 1, quote: "Yozib oling: +998 90 123 45 67 ga qo'ng'iroq qiling" }]);
  const q = iqtibos(db, "14", "nextStep");
  assert.ok(q.quote.includes("[tel]")); assert.ok(!/123 45 67/.test(q.quote));
  const db2 = baza();
  const b = qo(db2, { at: vaqt(1), crit: { nextStep: 0.4 } });
  tahlil(db2, b, [{ line: 1, quote: "past ball" }]);
  assert.equal(iqtibos(db2, "14", "nextStep"), null);
});
