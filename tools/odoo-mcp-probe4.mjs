import fs from "node:fs";
let url = "", auth = "";
for (const d of fs.readdirSync("/home/claude").filter((x) => x.startsWith(".claude-"))) { try { const c = JSON.parse(fs.readFileSync(`/home/claude/${d}/.claude.json`, "utf8")); const o = c.mcpServers?.odoo; if (o?.url) { url = o.url; auth = o.headers?.Authorization || ""; break; } } catch {} }
let id = 0, session = ""; const H = { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}) };
async function rpc(method, params) { const r = await fetch(url, { method: "POST", headers: { ...H, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) }); const sid = r.headers.get("mcp-session-id"); if (sid) session = sid; const t = await r.text(); if (t.includes("data:")) { const m = t.split("\n").filter((l) => l.startsWith("data:")).pop(); return JSON.parse(m.slice(5)); } try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; } }
await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "sotuv-probe", version: "0.4" } }); await rpc("notifications/initialized", {}).catch(() => {});
const call = async (name, args) => { const r = await rpc("tools/call", { name, arguments: args }); return r.result?.content?.map((c) => c.text).join("\n") ?? JSON.stringify(r.error || r); };
const J = (s) => { try { return JSON.parse(s); } catch { return null; } };
const fg = J(await call("odoo_fields_get", { model: "crm.lead" })); const fields = fg?.fields || fg || {};
const xs = Object.entries(fields).filter(([k]) => k.startsWith("x_")).map(([k, v]) => `${k} [${v.type}] ${v.string}`);
console.log("=== crm.lead x_ maydonlari (" + xs.length + ")"); console.log(xs.join("\n").slice(0, 4500));
const view = await call("odoo_get_view", { model: "crm.lead", view_type: "form" });
const arch = (J(view)?.arch) || view;
const buttons = [...String(arch).matchAll(/<button[^>]*?(?:name|string)="([^"]+)"[^>]*?(?:string|name)="([^"]+)"[^>]*>/g)].map((m) => `${m[1]} | ${m[2]}`);
console.log("=== form tugmalari (" + buttons.length + ")"); console.log(buttons.slice(0, 30).join("\n"));
const pages = [...String(arch).matchAll(/<page[^>]*string="([^"]+)"/g)].map((m) => m[1]);
console.log("=== form tablari:", pages.join(" | "));
const o2m = Object.entries(fields).filter(([k, v]) => v.type === "one2many" && k.startsWith("x_")).map(([k, v]) => `${k} → ${v.relation || "?"} (${v.string})`);
console.log("=== x_ one2many:", o2m.join("; ").slice(0, 600));
