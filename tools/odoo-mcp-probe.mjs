// odoo-mcp-probe.mjs — Odoo MCP (agentlar kaliti) bilan faqat o'qish sinovi. Kalit ekranga chiqmaydi.
import fs from "node:fs";
let url = "", auth = "";
const envf = "/home/claude/secrets/odoo-mcp.env";
if (fs.existsSync(envf)) {
  for (const l of fs.readFileSync(envf, "utf8").split("\n")) { const m = l.match(/^(ODOO_MCP_URL|ODOO_MCP_AUTH)=(.*)$/); if (m) { if (m[1] === "ODOO_MCP_URL") url = m[2]; else auth = m[2]; } }
} else {
  for (const d of fs.readdirSync("/home/claude").filter((x) => x.startsWith(".claude-"))) {
    try { const c = JSON.parse(fs.readFileSync(`/home/claude/${d}/.claude.json`, "utf8")); const o = c.mcpServers?.odoo; if (o?.url) { url = o.url; auth = o.headers?.Authorization || ""; break; } } catch {}
  }
}
if (!url) { console.log("MCP ulanish topilmadi"); process.exit(1); }
let id = 0; const H = { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}) };
let session = "";
async function rpc(method, params) {
  const r = await fetch(url, { method: "POST", headers: { ...H, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const sid = r.headers.get("mcp-session-id"); if (sid) session = sid;
  const t = await r.text();
  if (t.startsWith("event:") || t.includes("\ndata:")) { const m = t.split("\n").filter((l) => l.startsWith("data:")).pop(); return JSON.parse(m.slice(5)); }
  try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300), status: r.status }; }
}
const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "sotuv-probe", version: "0.1" } });
console.log("initialize:", init.result ? `${init.result.serverInfo?.name || "?"} ${init.result.serverInfo?.version || ""}` : JSON.stringify(init).slice(0, 200));
await rpc("notifications/initialized", {}).catch(() => {});
const tl = await rpc("tools/list", {});
const tools = tl.result?.tools || [];
console.log("tools:", tools.map((t) => t.name).join(", ") || JSON.stringify(tl).slice(0, 300));
const call = async (name, args) => { const r = await rpc("tools/call", { name, arguments: args }); const c = r.result?.content?.[0]?.text ?? JSON.stringify(r.error || r).slice(0, 400); return c; };
const short = (s, n = 500) => String(s).replace(/\s+/g, " ").slice(0, n);
console.log("crm.lead count:", short(await call("odoo_search_count", { model: "crm.lead", domain: [] }), 200));
console.log("crm.stage:", short(await call("odoo_search_read", { model: "crm.stage", domain: [], fields: ["name", "sequence", "team_id", "is_won"], limit: 40 }), 900));
console.log("crm.team:", short(await call("odoo_search_read", { model: "crm.team", domain: [], fields: ["name", "company_id"], limit: 20 }), 400));
console.log("res.company:", short(await call("odoo_search_read", { model: "res.company", domain: [], fields: ["name"], limit: 10 }), 300));
const f = await call("odoo_fields_get", { model: "crm.lead", attributes: ["string", "type"] });
try { const j = JSON.parse(f); const keys = Object.keys(j); console.log("crm.lead fields:", keys.length, "| x_:", keys.filter((k) => k.startsWith("x_")).join(", ")); } catch { console.log("crm.lead fields_get:", short(f, 600)); }
console.log("crm.lead type=lead (5):", short(await call("odoo_search_read", { model: "crm.lead", domain: [["type", "=", "lead"]], fields: ["name", "stage_id", "team_id", "source_id", "create_date"], limit: 5, order: "create_date desc" }), 700));
