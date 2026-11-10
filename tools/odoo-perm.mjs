import fs from "node:fs";
let url="",auth="";
for (const d of fs.readdirSync("/home/claude").filter(x=>x.startsWith(".claude-"))){try{const c=JSON.parse(fs.readFileSync(`/home/claude/${d}/.claude.json`,"utf8"));const o=c.mcpServers?.odoo;if(o?.url){url=o.url;auth=o.headers?.Authorization||"";break}}catch{}}
let id=0,session="";const H={"content-type":"application/json",accept:"application/json, text/event-stream",...(auth?{authorization:auth}:{})};
async function rpc(m,p){const r=await fetch(url,{method:"POST",headers:{...H,...(session?{"mcp-session-id":session}:{})},body:JSON.stringify({jsonrpc:"2.0",id:++id,method:m,params:p})});const s=r.headers.get("mcp-session-id");if(s)session=s;const t=await r.text();if(t.includes("data:")){return JSON.parse(t.split("\n").filter(l=>l.startsWith("data:")).pop().slice(5))}try{return JSON.parse(t)}catch{return{raw:t.slice(0,200)}}}
await rpc("initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"perm",version:"1"}});await rpc("notifications/initialized",{}).catch(()=>{});
const call=async(n,a)=>{const r=await rpc("tools/call",{name:n,arguments:a});return (r.result?.content?.map(c=>c.text).join("\n") ?? JSON.stringify(r.error||r)).replace(/\s+/g," ").slice(0,220)};
console.log("O'QISH:");
console.log(" lead []                    ", await call("odoo_search_count",{model:"crm.lead",domain:[]}));
console.log(" lead company_id=2 (SUN)    ", await call("odoo_search_count",{model:"crm.lead",domain:[["company_id","=",2]]}));
console.log(" lead company_id=1 (GG)     ", await call("odoo_search_count",{model:"crm.lead",domain:[["company_id","=",1]]}));
console.log(" lead active=false          ", await call("odoo_search_count",{model:"crm.lead",domain:[["active","=",false]]}));
console.log(" lead 14-sentabrdan keyin   ", await call("odoo_search_count",{model:"crm.lead",domain:[["create_date",">=","2026-09-14 00:00:00"]]}));
console.log(" SUN lead namunasi          ", await call("odoo_search_read",{model:"crm.lead",domain:[["company_id","=",2]],fields:["name","type","stage_id","team_id","user_id","create_date"],limit:3,order:"id desc"}));
console.log(" 'Test' lidi (video)        ", await call("odoo_search_read",{model:"crm.lead",domain:[["name","=","Test"]],fields:["name","stage_id","company_id","x_studio_1kw_uchun"],limit:2}));
console.log("YOZISH (xavfsiz zond — yozuv yaratilmaydi):");
console.log(" write yo'q id             ", await call("odoo_write",{model:"crm.lead",ids:[999999999],values:{name:"x"}}));
console.log(" create noto'g'ri maydon   ", await call("odoo_create",{model:"crm.lead",values:{__yoq_maydon__:"x"}}));
console.log(" activity_schedule zond    ", await call("odoo_activity_schedule",{model:"crm.lead",res_id:999999999,summary:"zond"}));
console.log(" server action (yo'q id)   ", await call("odoo_run_server_action",{action_id:999999,model:"crm.lead",ids:[1]}));
console.log(" partner write zond        ", await call("odoo_write",{model:"res.partner",ids:[999999999],values:{comment:"x"}}));
console.log(" sale.order write zond     ", await call("odoo_write",{model:"sale.order",ids:[999999999],values:{note:"x"}}));
