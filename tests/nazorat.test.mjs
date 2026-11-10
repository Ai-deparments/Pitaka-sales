// node --test tests/nazorat.test.mjs — tarmoq yo'q: vaqtinchalik SQLite va soxta Bitrix (sintetik ma'lumot).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initCallSchema } from "../lib/callstore.mjs";
import { initSifat } from "../lib/sifat.mjs";
import * as N from "../lib/nazorat.mjs";

const NOW = new Date().toISOString();
// 4 lid, 2 menejer (10, 20)
const LEADS = [
  { ID: "1", NAME: "Ali", STATUS_ID: "UC_O11I30", ASSIGNED_BY_ID: "10", UF_CRM_1776932197903: "900" },  // CRM nekval, AI kval → A
  { ID: "2", NAME: "Vali", STATUS_ID: "UC_3D7LNB", ASSIGNED_BY_ID: "10" },                              // CRM kval, AI nekval → B
  { ID: "3", NAME: "Gani", STATUS_ID: "CONVERTED", ASSIGNED_BY_ID: "20" },                              // CRM kval, AI kval → agree
  { ID: "4", NAME: "Sobir", STATUS_ID: "JUNK", ASSIGNED_BY_ID: "20" },                                   // AI noaniq → solishtirilmaydi
  { ID: "5", NAME: "Doni", STATUS_ID: "UC_AEH2UE", ASSIGNED_BY_ID: "20" },                               // ochiq
];
const ACTS = [
  { ID: "c1", RESPONSIBLE_ID: "10", OWNER_TYPE_ID: "1", OWNER_ID: "1", START_TIME: NOW },
  { ID: "c2", RESPONSIBLE_ID: "10", OWNER_TYPE_ID: "1", OWNER_ID: "2", START_TIME: NOW },
  { ID: "c3", RESPONSIBLE_ID: "20", OWNER_TYPE_ID: "1", OWNER_ID: "3", START_TIME: NOW },
  { ID: "c4", RESPONSIBLE_ID: "20", OWNER_TYPE_ID: "1", OWNER_ID: "4", START_TIME: NOW },
  { ID: "c5", RESPONSIBLE_ID: "20", OWNER_TYPE_ID: "2", OWNER_ID: "77", START_TIME: NOW },  // bitim — tahlilsiz
];
const fakeBx = {
  async call(method) {
    if (method === "crm.lead.fields") return { result: { UF_CRM_1776932197903: { items: [{ ID: "900", VALUE: "Qimmat" }] } } };
    throw new Error(`soxta bx: ${method} yo'q`);        // app.info → ismlar «#id»
  },
  async listAll(method, { filter = {} } = {}) {
    if (method === "crm.lead.list") return { items: LEADS.filter((x) => !filter.ASSIGNED_BY_ID || x.ASSIGNED_BY_ID === filter.ASSIGNED_BY_ID), total: LEADS.length };
    if (method === "crm.activity.list") return { items: ACTS, total: ACTS.length };
    return { items: [], total: 0 };
  },
};
const crit = (scores) => ["greeting", "needs", "questions", "listening", "value", "objection", "nextStep", "closing"]
  .map((id, i) => ({ id, label: id, max: 10, score: scores[i] }));
function makeDb() {
  const db = new DatabaseSync(":memory:");
  initCallSchema(db); initSifat(db);
  const put = (id, j) => db.prepare("INSERT INTO call_analyses (call_id,status,json,analyzed_at) VALUES (?,?,?,datetime('now'))").run(id, "ready", JSON.stringify(j));
  put("c1", { operator_score: { total: 40, criteria: crit([10, 2, 2, 10, 0, 10, 10, 0]) },
    kval: { verdict: "kval", reason: "model aytdi", quote: "17 Pro Max uchun chexol kerak" },
    missedSteps: ["Mini taqdimot", "Narx va kafolat"], lostReason: null });
  put("c2", { operator_score: { total: 70, criteria: crit([10, 10, 2, 10, 2, 10, 10, 10]) },
    kval: { verdict: "nekval", reason: "ariza qoldirmagan", quote: "men ariza qoldirmaganman" },
    missedSteps: ["Mini taqdimot"], lostReason: { text: "Qiziqmaydi", quote: "kerak emas" } });
  put("c3", { operator_score: { total: 90, criteria: crit([10, 10, 10, 10, 10, 10, 10, 10]) },
    kval: { verdict: "kval", reason: "buyurtma", quote: "olaman, manzilni yozing" }, missedSteps: [] });
  // c4: tahlil bor, kval iqtibossiz → lead_quality (noaniq) ishlatiladi
  put("c4", { operator_score: { total: 55, criteria: crit([5, 5, 5, 5, 5, 5, 5, 5]) }, kval: { verdict: "kval", reason: "x", quote: null } });
  db.prepare("INSERT INTO lead_quality (lead_id,verdict,reason,quote,call_id,basis) VALUES (?,?,?,?,?,?)").run("4", "noaniq", "qisqa", null, "c4", "b");
  return db;
}

test("classify: A / B / agree / noaniq / ochiq", () => {
  assert.equal(N.classify("nekval", "kval"), "A");
  assert.equal(N.classify("rad", "kval"), "A");
  assert.equal(N.classify("kval", "nekval"), "B");
  assert.equal(N.classify("kval", "kval"), "agree");
  assert.equal(N.classify("nekval", "nekval"), "agree");
  assert.equal(N.classify("kval", "noaniq"), null);
  assert.equal(N.classify("ochiq", "kval"), null);
  assert.equal(N.crmSide("UC_O11I30"), "nekval");
  assert.equal(N.crmSide("CONVERTED"), "kval");
  assert.equal(N.crmSide("JUNK"), "rad");
  assert.equal(N.crmSide("UC_AEH2UE"), "ochiq");
});

test("kvalCheck: totals, per manager and mismatch list", async () => {
  const r = await N.kvalCheck(fakeBx, makeDb(), { range: 31 });
  assert.equal(r.totals.leads, 5);
  assert.equal(r.totals.compared, 3);
  assert.equal(r.totals.A, 1);
  assert.equal(r.totals.B, 1);
  assert.equal(r.totals.agree, 1);
  assert.equal(r.totals.noaniq, 1);
  assert.equal(r.totals.ochiq, 1);
  assert.equal(r.list[0].type, "A");                       // A birinchi
  assert.equal(r.list[0].lead, "1");
  assert.equal(r.list[0].crm.reason, "Qimmat");
  assert.equal(r.list[0].ai.source, "call");
  assert.equal(r.list[0].ai.quote, "17 Pro Max uchun chexol kerak");
  const m10 = r.managers.find((m) => m.id === "10");
  assert.deepEqual([m10.compared, m10.A, m10.B, m10.agree], [2, 1, 1, 0]);
  const m20 = r.managers.find((m) => m.id === "20");
  assert.equal(m20.agreePct, 100);
});

test("kvalCheck: seller sees only own leads", async () => {
  const r = await N.kvalCheck(fakeBx, makeDb(), { range: 32, owner: "20" });
  assert.ok(r.managers.every((m) => m.id === "20"));
  assert.equal(r.totals.A + r.totals.B, 0);
});

test("violations: per manager criteria, fails, missed steps, worst calls", async () => {
  const r = await N.violations(fakeBx, makeDb(), { range: 33 });
  assert.equal(r.attribution, N.ATTRIBUTION);
  assert.equal(r.analysed, 4);
  const m10 = r.managers.find((m) => m.id === "10");
  assert.equal(m10.calls, 2);
  assert.equal(m10.avgScore, 55);
  const value = m10.criteria.find((c) => c.id === "value");
  assert.deepEqual([value.avgPct, value.failed, value.of], [10, 2, 2]);
  assert.equal(m10.weakest[0].id, "value");
  assert.deepEqual(m10.missedSteps[0], { step: "Mini taqdimot", n: 2 });
  assert.equal(m10.kval.kval, 1);
  assert.equal(m10.kval.nekval, 1);
  assert.equal(m10.lostReasons[0].callId, "c2");
  assert.equal(m10.worstCalls[0].id, "c1");
  assert.equal(r.team.calls, 4);
});

test("violations: owner filter keeps only that manager, no team block", async () => {
  const r = await N.violations(fakeBx, makeDb(), { range: 34, owner: "20" });
  assert.equal(r.team, null);
  assert.ok(r.managers.every((m) => m.id === "20"));
  assert.equal(r.analysed, 2);
});
