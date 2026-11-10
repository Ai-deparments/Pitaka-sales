import fs from "node:fs";
let url="",auth="";
for (const d of fs.readdirSync("/home/claude").filter(x=>x.startsWith(".claude-"))){try{const c=JSON.parse(fs.readFileSync(`/home/claude/${d}/.claude.json`,"utf8"));const o=c.mcpServers?.odoo;if(o?.url){url=o.url;auth=o.headers?.Authorization||"";break}}catch{}}
let id=0,session="";const H={"content-type":"application/json",accept:"application/json, text/event-stream",...(auth?{authorization:auth}:{})};
async function rpc(m,p){const r=await fetch(url,{method:"POST",headers:{...H,...(session?{"mcp-session-id":session}:{})},body:JSON.stringify({jsonrpc:"2.0",id:++id,method:m,params:p})});const s=r.headers.get("mcp-session-id");if(s)session=s;const t=await r.text();if(t.includes("data:"))return JSON.parse(t.split("\n").filter(l=>l.startsWith("data:")).pop().slice(5));try{return JSON.parse(t)}catch{return{raw:t.slice(0,200)}}}
await rpc("initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"fields",version:"1"}});await rpc("notifications/initialized",{}).catch(()=>{});
const call=async(n,a)=>{const r=await rpc("tools/call",{name:n,arguments:a});return r.result?.content?.map(c=>c.text).join("\n") ?? JSON.stringify(r.error||r)};
const raw = await call("odoo_fields_get",{model:"crm.lead"});
let F={}; try{const j=JSON.parse(raw); F=j.fields||j;}catch(e){console.log("fields_get:",raw.slice(0,200));process.exit(1)}
const want = /tarif|invertor|panel|konstruk|elektr|maqsad|type_1|tip$|tulov|manba|xudud|istemol|1kw|1_kvt|kvt|narx|quvvat|tavsiya|kerak|garant|kafolat|tom|gradus|oylik|sarf/i;
const rows = Object.entries(F).filter(([k,v]) => k.startsWith("x_") && (want.test(k) || want.test(v.string||"")));
for (const [k,v] of rows) {
  const sel = v.selection ? " :: " + v.selection.map(s=>Array.isArray(s)?s[0]:s).join(" | ") : "";
  console.log(`${k} [${v.type}] ${(v.string||"").slice(0,48)}${sel.slice(0,220)}`);
}
console.log("--- standart (x_ emas) kerakli maydonlar:");
for (const k of ["name","contact_name","phone","email_from","street","city","state_id","team_id","user_id","stage_id","source_id","type","expected_revenue","description","partner_id","company_id","campaign_id","medium_id"]) if (F[k]) console.log(` ${k} [${F[k].type}] ${F[k].string}`);
