// node --test tests/mezon.test.mjs — tarmoq yo'q: soxta Bitrix, vaqtinchalik SQLite (sintetik ma'lumot).
// Pitaka: lid va bitim ID'lari har xil sonlar — bitimdagi qo'ng'iroq bitimning LEAD_ID'siga tegishli bo'lishi kerak,
// bitim ID'si lid ID'si deb olinmasin (voronkadagi «Xatolar narxi» shu bilan hisoblanadi).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { initCallSchema } from "../lib/callstore.mjs";
import { leadOfCall, mezonKesim } from "../lib/calls.mjs";

test("leadOfCall: lid → o'zi, bitim → LEAD_ID, lidsiz bitim va boshqalar → null", () => {
  assert.equal(leadOfCall({ entity: { kind: "lead", id: "30907" } }), "30907");
  assert.equal(leadOfCall({ entity: { kind: "deal", id: "51700" }, deal: { leadId: "30880" } }), "30880");
  assert.equal(leadOfCall({ entity: { kind: "deal", id: "51700" }, deal: { leadId: null } }), null);
  assert.equal(leadOfCall({ entity: { kind: "deal", id: "51700" } }), null);
  assert.equal(leadOfCall({ entity: { kind: "contact", id: "9" } }), null);
  assert.equal(leadOfCall({ entity: null }), null);
});

const NOW = new Date().toISOString();
const ACTS = [
  { ID: "m1", RESPONSIBLE_ID: "10", OWNER_TYPE_ID: "1", OWNER_ID: "100", START_TIME: NOW, END_TIME: NOW, CREATED: NOW },
  { ID: "m2", RESPONSIBLE_ID: "10", OWNER_TYPE_ID: "2", OWNER_ID: "5000", START_TIME: NOW, END_TIME: NOW, CREATED: NOW },
  { ID: "m3", RESPONSIBLE_ID: "20", OWNER_TYPE_ID: "2", OWNER_ID: "5001", START_TIME: NOW, END_TIME: NOW, CREATED: NOW },
];
const DEALS = [{ ID: "5000", TITLE: "iPhone 17 Pro Max chexol", STAGE_ID: "NEW", LEAD_ID: "101" },
               { ID: "5001", TITLE: "Samsung chexol (to'g'ridan-to'g'ri)", STAGE_ID: "NEW", LEAD_ID: null }];
const fakeBx = {
  async listAll(method) {
    if (method === "crm.activity.list") return { items: ACTS, total: ACTS.length };
    return { items: [], total: 0 };
  },
  async call(method, { filter = {} } = {}) {
    const ids = new Set((filter["@ID"] || []).map(String));
    if (method === "crm.deal.list") return { result: DEALS.filter((d) => ids.has(d.ID)) };
    if (method === "crm.lead.list") return { result: [{ ID: "100", TITLE: "Lid 100" }].filter((d) => ids.has(d.ID)) };
    if (method === "crm.status.list") return { result: [] };
    if (method === "app.info") return { result: { SCOPE: ["crm", "disk"] } };
    return { result: [] };
  },
};

test("mezonKesim: bitimdagi qo'ng'iroq bitimning lidiga yoziladi, bitim ID'siga emas", async () => {
  const db = new DatabaseSync(":memory:");
  initCallSchema(db);
  const j = JSON.stringify({ operator_score: { total: 50, criteria: [{ id: "greeting", max: 10, score: 5 }] } });
  for (const id of ["m1", "m2", "m3"])
    db.prepare("INSERT INTO call_analyses (call_id,status,json,analyzed_at) VALUES (?,?,?,datetime('now'))").run(id, "ready", j);
  const rows = await mezonKesim(fakeBx, db, 31);
  const by = Object.fromEntries(rows.map((r) => [r.id, r.lead]));
  assert.equal(by.m1, "100");          // lid qo'ng'irog'i
  assert.equal(by.m2, "101");          // bitim 5000 → uning lidi 101 (5000 emas)
  assert.equal(by.m3, null);           // lidsiz bitim — lid statistikasiga kirmaydi
  assert.ok(!rows.some((r) => r.lead === "5000" || r.lead === "5001"));
});
