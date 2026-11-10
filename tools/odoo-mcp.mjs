// odoo-mcp.mjs — tezkor-ombor uchun Odoo MCP chaqiruvi: agentning o'sha kaliti, o'sha server.
// FAQAT O'QISH: pastdagi OQISH ro'yxatidan tashqari asbob chaqirilsa — throw, tarmoqqa chiqmaydi.
// Kalitda yozadigan asboblar ham bor (odoo_create / odoo_write / odoo_unlink / odoo_execute /
// odoo_run_server_action / odoo_send_email). Ombor yo'lida ular KERAK EMAS, shuning uchun bu
// modul darajasida yopilgan: xato qilib chaqirilsa, Odoo'ga umuman bormaydi.
//
// 2026-10-29 tirik sxema bilan tekshirilgan (037/038/039). Javob shakli O'ZGARTIRILMAYDI:
// server nima qaytarsa, shu qaytadi — `odoo_read_group` → {groups:[[…]], groupby, aggregates},
// `odoo_search_count` → {count:N}. Normallashtirish `ombor-ctx.mjs` dagi `guruhlar()` /
// `sanoq()` da, va u testlar bilan qoplangan.
//
// NEGA shunday: dastlab shaklni shu modul normallashtirdi va tirik sinov o'tdi — chunki
// `guruhlar()` tayyor massivni o'zi o'tkazib yuboradi. Natijada prodda MENING yo'lim
// ishlardi, testlar esa ISHLAMAYDIGAN yo'lni tekshirardi. Ikki normallashtiruvchi — tuzoq,
// shuning uchun bu modul faqat tashiydi.
import fs from "node:fs";

const BASE = process.env.AI_AGENT_HOME || "/home/claude";

const OQISH = new Set([
  "odoo_search_read", "odoo_search", "odoo_search_count", "odoo_read", "odoo_read_group",
  "odoo_fields_get", "odoo_describe_model", "odoo_list_models", "odoo_name_search",
  "odoo_glossary", "odoo_list_metrics", "odoo_menu_tree", "odoo_user_context",
]);

// Manba tartibi panel klienti bilan bir xil: secrets/odoo-mcp.env → istalgan agentning .claude.json.
function ulanish() {
  const envf = `${BASE}/secrets/odoo-mcp.env`;
  if (fs.existsSync(envf)) {
    let url = "", auth = "";
    for (const l of fs.readFileSync(envf, "utf8").split("\n")) {
      const m = l.match(/^(ODOO_MCP_URL|ODOO_MCP_AUTH)=(.*)$/);
      if (m) (m[1] === "ODOO_MCP_URL" ? (url = m[2]) : (auth = m[2]));
    }
    if (url) return { url, auth };
  }
  for (const d of fs.readdirSync(BASE).filter((x) => x.startsWith(".claude-"))) {
    try {
      const o = JSON.parse(fs.readFileSync(`${BASE}/${d}/.claude.json`, "utf8")).mcpServers?.odoo;
      if (o?.url) return { url: o.url, auth: o.headers?.Authorization || "" };
    } catch { /* keyingi agent */ }
  }
  throw new Error("Odoo MCP ulanishi topilmadi (secrets/odoo-mcp.env yoki agent .claude.json)");
}

let S = null;   // { url, auth, session, id }

async function rpc(method, params) {
  const h = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (S.auth) h.authorization = S.auth;
  if (S.session) h["mcp-session-id"] = S.session;
  const r = await fetch(S.url, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: ++S.id, method, params }) });
  const sid = r.headers.get("mcp-session-id"); if (sid) S.session = sid;
  const txt = await r.text();
  // MCP javobi SSE (`data:`) yoki oddiy JSON bo'lishi mumkin.
  if (txt.includes("data:")) {
    const line = txt.split("\n").filter((l) => l.startsWith("data:")).pop();
    return JSON.parse(line.slice(5));
  }
  try { return JSON.parse(txt); } catch { return { raw: txt.slice(0, 300), status: r.status }; }
}

// JSON-RPC bildirishnomasi `id` SIZ ketadi va javob kutilmaydi. Panel klienti uni oddiy
// so'rov sifatida (id bilan) yuboradi — ba'zi MCP serverlar bunga xato qaytaradi.
async function bildir(method, params) {
  const h = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (S.auth) h.authorization = S.auth;
  if (S.session) h["mcp-session-id"] = S.session;
  await fetch(S.url, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", method, params }) }).catch(() => { });
}

async function boshla() {
  if (S) return;
  S = { ...ulanish(), session: "", id: 0 };
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "tezkor-ombor", version: "1.0" } });
  await bildir("notifications/initialized", {});
}

async function birMarta(tool, args) {
  await boshla();
  const r = await rpc("tools/call", { name: tool, arguments: args });
  if (r.error) throw Object.assign(new Error(r.error.message || "MCP xatosi"), { code: r.error.code });
  if (r.raw !== undefined && Number(r.status) >= 400) {
    const m = String(r.raw).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    throw Object.assign(new Error(`Odoo ${r.status}: ${m.slice(0, 200)}`), { code: r.status });
  }
  const matn = r.result?.content?.map((c) => c.text).join("\n") ?? "";
  // Yozadigan amallar tasdiq so'raydi — bu yerga tushmasligi kerak, lekin jim o'tkazmaymiz.
  if (/CONFIRMATION REQUIRED/i.test(matn)) {
    throw Object.assign(new Error("tasdiq talab qilindi — o'qish yo'lida bunday bo'lmasligi kerak"), { qaytarmaymiz: true });
  }
  try { return JSON.parse(matn); } catch { return { matn }; }
}

// Yangi sessiya yordam BERMAYDIGAN xatolar: qayta urinish faqat zarar.
//  - «out of scope» — kalit doirasi, sessiyaga aloqasi yo'q;
//  - «Rate limit» — qayta urinish chegarani yana uradi;
//  - tasdiq talabi — o'qish yo'lida bo'lmasligi kerak, yashirmaymiz.
// R17 «har xatoda bitta qayta urinish» deydi; bu uchtasi ataylab chiqarilgan, sababi yuqorida.
function qaytarishMumkin(e) {
  if (e?.qaytarmaymiz) return false;
  const m = String(e?.message || e);
  return !/out of scope|rate limit/i.test(m);
}

export async function odoo(tool, args) {
  if (!OQISH.has(tool)) throw new Error(`${tool} — bu modul faqat o'qiydi, chaqirilmaydi`);
  try {
    return await birMarta(tool, args);
  } catch (e) {
    // Panel jarayoni sutkalab yashaydi: `mcp-session-id` eskiradi va har chaqiruv yiqila
    // boshlaydi — restart'gacha ombor yo'li jim o'ladi. Shuning uchun sessiyani tashlab,
    // BIR marta yangisi bilan urinamiz.
    if (!qaytarishMumkin(e)) throw e;
    S = null;
    return await birMarta(tool, args);
  }
}
