import fs from "node:fs";
let url = "", auth = "";
const envf = "/home/claude/secrets/odoo-mcp.env";
if (fs.existsSync(envf)) { for (const l of fs.readFileSync(envf, "utf8").split("\n")) { const m = l.match(/^(ODOO_MCP_URL|ODOO_MCP_AUTH)=(.*)$/); if (m) { if (m[1] === "ODOO_MCP_URL") url = m[2]; else auth = m[2]; } } }
else { for (const d of fs.readdirSync("/home/claude").filter((x) => x.startsWith(".claude-"))) { try { const c = JSON.parse(fs.readFileSync(`/home/claude/${d}/.claude.json`, "utf8")); const o = c.mcpServers?.odoo; if (o?.url) { url = o.url; auth = o.headers?.Authorization || ""; break; } } catch {} } }
let id = 0, session = ""; const H = { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}) };
async function rpc(method, params) { const r = await fetch(url, { method: "POST", headers: { ...H, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) }); const sid = r.headers.get("mcp-session-id"); if (sid) session = sid; const t = await r.text(); if (t.includes("data:")) { const m = t.split("\n").filter((l) => l.startsWith("data:")).pop(); return JSON.parse(m.slice(5)); } try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; } }
await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "sotuv-probe", version: "0.2" } }); await rpc("notifications/initialized", {}).catch(() => {});
const call = async (name, args) => { const r = await rpc("tools/call", { name, arguments: args }); return r.result?.content?.map((c) => c.text).join("\n") ?? JSON.stringify(r.error || r); };
const short = (s, n) => String(s).replace(/\s+/g, " ").slice(0, n);
const schema = (await rpc("tools/list", {})).result?.tools?.reduce((m, t) => (m[t.name] = t.inputSchema?.properties ? Object.keys(t.inputSchema.properties) : [], m), {}) || {};
console.log("args search_read:", schema.odoo_search_read?.join(","), "| fields_get:", schema.odoo_fields_get?.join(","), "| create:", schema.odoo_create?.join(","), "| print_report:", schema.odoo_print_report?.join(","));
console.log("user_context:", short(await call("odoo_user_context", {}), 700));
console.log("list_models:", short(await call("odoo_list_models", {}), 1200));
console.log("lead by company/type:", short(await call("odoo_read_group", { model: "crm.lead", domain: [], fields: ["id:count"], groupby: ["company_id", "type"] }), 500));
console.log("lead all (10):", short(await call("odoo_search_read", { model: "crm.lead", domain: [], fields: ["name", "type", "company_id", "stage_id", "team_id", "create_date"], limit: 10, order: "id desc" }), 900));
console.log("describe crm.lead:", short(await call("odoo_describe_model", { model: "crm.lead" }), 1500));
console.log("menu_tree:", short(await call("odoo_menu_tree", {}), 800));
console.log("x_oylik_plan:", short(await call("odoo_search_count", { model: "x_oylik_plan", domain: [] }), 200), "| client.contract:", short(await call("odoo_search_count", { model: "client.contract", domain: [] }), 200), "| sale.order:", short(await call("odoo_search_count", { model: "sale.order", domain: [] }), 200));
