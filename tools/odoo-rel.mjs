import fs from "node:fs";
let url="",auth="";
for (const d of fs.readdirSync("/home/claude").filter(x=>x.startsWith(".claude-"))){try{const c=JSON.parse(fs.readFileSync(`/home/claude/${d}/.claude.json`,"utf8"));const o=c.mcpServers?.odoo;if(o?.url){url=o.url;auth=o.headers?.Authorization||"";break}}catch{}}
let id=0,session="";const H={"content-type":"application/json",accept:"application/json, text/event-stream",...(auth?{authorization:auth}:{})};
async function rpc(m,p){const r=await fetch(url,{method:"POST",headers:{...H,...(session?{"mcp-session-id":session}:{})},body:JSON.stringify({jsonrpc:"2.0",id:++id,method:m,params:p})});const s=r.headers.get("mcp-session-id");if(s)session=s;const t=await r.text();if(t.includes("data:"))return JSON.parse(t.split("\n").filter(l=>l.startsWith("data:")).pop().slice(5));try{return JSON.parse(t)}catch{return{raw:t.slice(0,200)}}}
await rpc("initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"rel",version:"1"}});await rpc("notifications/initialized",{}).catch(()=>{});
const call=async(n,a)=>{const r=await rpc("tools/call",{name:n,arguments:a});return r.result?.content?.map(c=>c.text).join("\n") ?? JSON.stringify(r.error||r)};
const F=JSON.parse(await call("odoo_fields_get",{model:"crm.lead"})); const f=F.fields||F;
const m2o=["x_studio_panel_1","x_studio_power","x_studio_konstruksiya","x_studio_elektrika","x_studio_oylik_istemol","x_studio_many2one_field_1bh_1jml9f782"];
const rels={};
for (const k of m2o) if (f[k]) { rels[k]=f[k].relation; console.log(`${k} -> ${f[k].relation} (${f[k].type})`); }
console.log("--- scope sinovi");
for (const r of [...new Set(Object.values(rels).filter(Boolean))]) {
  const res = await call("odoo_search_read",{model:r,domain:[],fields:["display_name"],limit:6});
  console.log(` ${r}: ${res.replace(/\s+/g," ").slice(0,190)}`);
}
console.log("--- 'Test' jamoasi lidi (yozish uchun namuna)");
console.log((await call("odoo_search_read",{model:"crm.lead",domain:[["team_id","=",21]],fields:["name","stage_id","type","company_id","x_studio_tarif","x_studio_panel","x_studio_invertor","x_studio_1kw_uchun","x_ornatilishi_kerak"],limit:2,order:"id desc"})).replace(/\s+/g," ").slice(0,600));
