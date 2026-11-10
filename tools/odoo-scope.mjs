import fs from "node:fs";
let url="",auth="";
for (const d of fs.readdirSync("/home/claude").filter(x=>x.startsWith(".claude-"))){try{const c=JSON.parse(fs.readFileSync(`/home/claude/${d}/.claude.json`,"utf8"));const o=c.mcpServers?.odoo;if(o?.url){url=o.url;auth=o.headers?.Authorization||"";break}}catch{}}
let id=0,session="";const H={"content-type":"application/json",accept:"application/json, text/event-stream",...(auth?{authorization:auth}:{})};
async function rpc(m,p){const r=await fetch(url,{method:"POST",headers:{...H,...(session?{"mcp-session-id":session}:{})},body:JSON.stringify({jsonrpc:"2.0",id:++id,method:m,params:p})});const s=r.headers.get("mcp-session-id");if(s)session=s;const t=await r.text();if(t.includes("data:"))return JSON.parse(t.split("\n").filter(l=>l.startsWith("data:")).pop().slice(5));try{return JSON.parse(t)}catch{return{raw:t.slice(0,200)}}}
await rpc("initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"scope",version:"1"}});await rpc("notifications/initialized",{}).catch(()=>{});
const call=async(n,a)=>{const r=await rpc("tools/call",{name:n,arguments:a});return (r.result?.content?.map(c=>c.text).join("\n") ?? JSON.stringify(r.error||r)).replace(/\s+/g," ").slice(0,200)};
console.log("res.users     ", await call("odoo_search_read",{model:"res.users",domain:[["id","=",185]],fields:["login","company_id","company_ids"],limit:1}));
console.log("res.groups    ", await call("odoo_search_count",{model:"res.groups",domain:[]}));
console.log("crm.team      ", await call("odoo_search_count",{model:"crm.team",domain:[]}));
console.log("execute zond  ", await call("odoo_execute",{model:"crm.lead",method:"search_count",args:[[["company_id","=",2]]]}));
console.log("user_context  ", await call("odoo_user_context",{}));
// Ko'rinadigan lidlarning jamoasi/kompaniyasi — sabab aniqlash uchun
console.log("7 lid kesimi  ", await call("odoo_search_read",{model:"crm.lead",domain:[],fields:["name","company_id","team_id","user_id","type","active"],limit:7}));
