// odoo-mcp.test.mjs — sessiya eskirganda qayta ulanish (R17). Tarmoqqa CHIQMAYDI: `fetch` almashtiriladi.
// Nega kerak: panel jarayoni sutkalab yashaydi, `mcp-session-id` eskiradi va rastartgacha
// ombor yo'li jim o'ladi. Shuni tekshiramiz, yana: qaysi xatolarda qayta urinish YO'Q.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// `ulanish()` secrets/odoo-mcp.env ni o'qiydi — soxta uy katalogi yasaymiz.
const UY = fs.mkdtempSync(path.join(os.tmpdir(), "odoo-mcp-sinov-"));
fs.mkdirSync(path.join(UY, "secrets"), { recursive: true });
fs.writeFileSync(path.join(UY, "secrets", "odoo-mcp.env"),
  "ODOO_MCP_URL=http://127.0.0.1:1/mcp\nODOO_MCP_AUTH=Bearer sinov\n");
process.env.AI_AGENT_HOME = UY;

const { odoo } = await import("./odoo-mcp.mjs");

const asl = globalThis.fetch;
function javob(obj, status = 200) {
  return { status, headers: { get: (k) => (k === "mcp-session-id" ? "sinov-sessiya" : null) }, text: async () => JSON.stringify(obj) };
}
const natija = (matn) => ({ jsonrpc: "2.0", id: 1, result: { content: [{ text: matn }] } });

test("sessiya xatosidan keyin bitta qayta urinish — javob keladi", async () => {
  const yozuv = [];
  let qadam = 0;
  globalThis.fetch = async (url, opt) => {
    const b = JSON.parse(opt.body);
    yozuv.push(b.method);
    if (b.method !== "tools/call") return javob({ jsonrpc: "2.0", id: b.id, result: {} });
    qadam++;
    if (qadam === 1) return javob({ jsonrpc: "2.0", id: b.id, error: { code: -32001, message: "Session not found" } });
    return javob(natija(JSON.stringify({ count: 7 })));
  };
  const r = await odoo("odoo_search_count", { model: "mrp.bom", domain: [] });
  assert.deepEqual(r, { count: 7 });
  // Ikki initialize bo'lishi SHART: sessiya tashlangani shundan ko'rinadi.
  assert.equal(yozuv.filter((m) => m === "initialize").length, 2, "yangi sessiya ochilmagan");
  assert.equal(yozuv.filter((m) => m === "tools/call").length, 2);
  globalThis.fetch = asl;
});

test("«out of scope» — qayta urinmaydi", async () => {
  let n = 0;
  globalThis.fetch = async (url, opt) => {
    const b = JSON.parse(opt.body);
    if (b.method !== "tools/call") return javob({ jsonrpc: "2.0", id: b.id, result: {} });
    n++;
    return javob({ jsonrpc: "2.0", id: b.id, error: { code: -32602, message: "Model 'stock.picking' out of scope" } });
  };
  await assert.rejects(() => odoo("odoo_search_count", { model: "stock.picking", domain: [] }), /out of scope/);
  assert.equal(n, 1, "doira xatosida qayta urinilgan — bu zarar");
  globalThis.fetch = asl;
});

test("«Rate limit» — qayta urinmaydi", async () => {
  let n = 0;
  globalThis.fetch = async (url, opt) => {
    const b = JSON.parse(opt.body);
    if (b.method !== "tools/call") return javob({ jsonrpc: "2.0", id: b.id, result: {} });
    n++;
    return javob({ jsonrpc: "2.0", id: b.id, error: { code: -32004, message: "Rate limit exceeded — try again in 60s" } });
  };
  await assert.rejects(() => odoo("odoo_search_count", { model: "mrp.bom", domain: [] }), /Rate limit/);
  assert.equal(n, 1, "chegara xatosida qayta urinilgan — chegarani yana uradi");
  globalThis.fetch = asl;
});

test("yozadigan asbob tarmoqqa umuman chiqmaydi", async () => {
  let n = 0;
  globalThis.fetch = async () => { n++; return javob(natija("{}")); };
  await assert.rejects(() => odoo("odoo_write", { model: "res.partner", ids: [1], values: {} }), /faqat o'qiydi/);
  assert.equal(n, 0, "yozish urinishi tarmoqqa chiqdi");
  globalThis.fetch = asl;
});
