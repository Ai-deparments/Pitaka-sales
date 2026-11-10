import fs from "node:fs";
let url = "", auth = "";
for (const d of fs.readdirSync("/home/claude").filter((x) => x.startsWith(".claude-"))) { try { const c = JSON.parse(fs.readFileSync(`/home/claude/${d}/.claude.json`, "utf8")); const o = c.mcpServers?.odoo; if (o?.url) { url = o.url; auth = o.headers?.Authorization || ""; break; } } catch {} }
let id = 0, session = ""; const H = { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}) };
async function rpc(method, params) { const r = await fetch(url, { method: "POST", headers: { ...H, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) }); const sid = r.headers.get("mcp-session-id"); if (sid) session = sid; const t = await r.text(); if (t.includes("data:")) { const m = t.split("\n").filter((l) => l.startsWith("data:")).pop(); return JSON.parse(m.slice(5)); } try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; } }
await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "sotuv-probe", version: "0.3" } }); await rpc("notifications/initialized", {}).catch(() => {});
const call = async (name, args) => { const r = await rpc("tools/call", { name, arguments: args }); return r.result?.content?.map((c) => c.text).join("\n") ?? JSON.stringify(r.error || r); };
const short = (s, n) => String(s).replace(/\s+/g, " ").slice(0, n);
const J = (s) => { try { return JSON.parse(s); } catch { return null; } };
const fg = J(await call("odoo_fields_get", { model: "crm.lead" }));
const fields = fg?.fields || fg || {};
const names = Object.keys(fields);
console.log("crm.lead fields:", names.length, "| x_:", names.filter((k) => k.startsWith("x_")).map((k) => `${k}(${fields[k]?.string || ""})`).join(", ").slice(0, 900));
console.log("stage/team/source fields:", ["stage_id", "team_id", "source_id", "user_id", "type", "probability", "expected_revenue", "phone", "city", "state_id"].filter((k) => names.includes(k)).join(","));
console.log("SO 3305:", short(await call("odoo_search_read", { model: "sale.order", domain: [["name", "ilike", "3305"]], fields: ["name", "partner_id", "amount_total", "state", "company_id", "create_date"], limit: 3 }), 500));
console.log("SO latest:", short(await call("odoo_search_read", { model: "sale.order", domain: [], fields: ["name", "partner_id", "amount_total", "state", "company_id"], limit: 3, order: "id desc" }), 500));
console.log("contract latest:", short(await call("odoo_search_read", { model: "client.contract", domain: [], fields: ["name", "partner_id", "state", "create_date"], limit: 3, order: "id desc" }), 500));
console.log("contract fields:", short(Object.keys((J(await call("odoo_fields_get", { model: "client.contract" }))?.fields) || {}).join(","), 600));
console.log("leads team!=21:", short(await call("odoo_search_count", { model: "crm.lead", domain: [["team_id", "!=", 21]] }), 100), "| active any:", short(await call("odoo_search_count", { model: "crm.lead", domain: [["active", "in", [true, false]]] }), 100), "| SUN company:", short(await call("odoo_search_count", { model: "crm.lead", domain: [["company_id.name", "ilike", "SUN"]] }), 200));
console.log("lead 'Test' (video):", short(await call("odoo_search_read", { model: "crm.lead", domain: [["name", "=", "Test"]], fields: ["name", "type", "stage_id", "team_id", "company_id", "user_id", "create_date"], limit: 3 }), 500));
console.log("x_oylik_plan:", short(await call("odoo_search_read", { model: "x_oylik_plan", domain: [], fields: [], limit: 2 }), 500));
console.log("gg.field.visit count:", short(await call("odoo_search_count", { model: "gg.field.visit", domain: [] }), 100));
console.log("glossary:", short(await call("odoo_glossary", {}), 600));
