// mcp.mjs — Odoo MCP klienti (agentlar bilan bir xil kalit). Kalit faylda qoladi, hech qayerga chiqmaydi.
// Manba tartibi: secrets/odoo-mcp.env → istalgan agentning .claude.json.
import fs from "node:fs";

const BASE = process.env.AI_AGENT_HOME || "/home/claude";

export function ulanish() {
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
    } catch { }
  }
  throw new Error("Odoo MCP ulanishi topilmadi (secrets/odoo-mcp.env yoki agent .claude.json)");
}

export class Odoo {
  constructor({ url, auth } = ulanish()) {
    this.url = url; this.auth = auth; this.id = 0; this.session = "";
    this.stats = { calls: 0, errors: 0, ms: [] };
  }
  async rpc(method, params) {
    const h = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (this.auth) h.authorization = this.auth;
    if (this.session) h["mcp-session-id"] = this.session;
    const t0 = Date.now();
    const r = await fetch(this.url, { method: "POST", headers: h, body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }) });
    const sid = r.headers.get("mcp-session-id"); if (sid) this.session = sid;
    const txt = await r.text();
    this.stats.calls++; this.stats.ms.push(Date.now() - t0);
    // MCP javobi SSE (`data:`) yoki oddiy JSON bo'lishi mumkin
    if (txt.includes("data:")) {
      const line = txt.split("\n").filter((l) => l.startsWith("data:")).pop();
      return JSON.parse(line.slice(5));
    }
    try { return JSON.parse(txt); } catch { return { raw: txt.slice(0, 300), status: r.status }; }
  }
  async boshla() {
    const r = await this.rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "sotuv-avtomat", version: "1.0" } });
    await this.rpc("notifications/initialized", {}).catch(() => { });
    this.server = r.result?.serverInfo || null;
    return this;
  }
  // tools/call. `confirm` — mn_mcp_server tasdiq talab qilgan amallar uchun (server action, execute).
  async ch(tool, args, { confirm = false } = {}) {
    const r = await this.rpc("tools/call", { name: tool, arguments: confirm ? { ...args, confirm: true } : args });
    if (r.error) { this.stats.errors++; throw Object.assign(new Error(r.error.message || "MCP xatosi"), { code: r.error.code }); }
    // HTTP xato (masalan 422 validatsiya) JSON emas, HTML qaytadi — jim o'tkazib yubormaymiz
    if (r.raw !== undefined && Number(r.status) >= 400) { this.stats.errors++; const m = String(r.raw).replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim(); throw Object.assign(new Error(`Odoo ${r.status}: ${m.slice(0, 240)}`), { code: r.status }); }
    const text = r.result?.content?.map((c) => c.text).join("\n") ?? "";
    if (/CONFIRMATION REQUIRED/i.test(text)) { const e = new Error("tasdiq kerak"); e.tasdiq = true; e.matn = text; throw e; }
    try { return JSON.parse(text); } catch { return { matn: text }; }
  }
  // Qulayliklar
  oqi = (model, domain, fields, opt = {}) => this.ch("odoo_search_read", { model, domain, fields, limit: opt.limit ?? 20, ...(opt.order ? { order: opt.order } : {}) });
  son = (model, domain) => this.ch("odoo_search_count", { model, domain });
  yarat = (model, values) => this.ch("odoo_create", { model, values });
  yoz = (model, ids, values) => this.ch("odoo_write", { model, ids, values });
  maydonlar = (model) => this.ch("odoo_fields_get", { model });
  // Sxema: odoo_activity_schedule{model,id,summary,date_deadline?,user_id?} · odoo_message_post{model,id,body,subject?}
  aktivlik = (model, id, args) => this.ch("odoo_activity_schedule", { model, id: Number(id), ...args });
  xabar = (model, id, body) => this.ch("odoo_message_post", { model, id: Number(id), body });
  // odoo_create javobi bo'sh bo'lishi mumkin (id qaytmaydi) — yozuvni MAXSUS BELGI bo'yicha qidirib topamiz.
  // Topilmasa: yozuv kalitning standart kompaniyasida (ko'rinmaydigan) yaratilgan — shuni aniq aytamiz.
  async yaratVaTop(model, values, belgiMaydon = "name") {
    const res = await this.yarat(model, values);
    const rid = Number(res && (res.id ?? (Array.isArray(res) ? res[0] : undefined)));   // 2026-09-20: odoo_create endi {"id": N} qaytaradi
    if (Number.isFinite(rid) && rid > 0) return rid;
    const q = await this.oqi(model, [[belgiMaydon, "like", String(values[belgiMaydon]).slice(0, 40)]], ["id", belgiMaydon], { limit: 5, order: "id desc" });
    const rec = (q.records || [])[0];
    if (!rec) { const e = new Error(`yozuv yaratildi, lekin qayta o'qilmadi (${model}) — kalit ko'rinish qoidasi`); e.korinmas = true; throw e; }
    return rec.id;
  }
  amal = (action_id, model, ids) => this.ch("odoo_run_server_action", { action_id, model, ids }, { confirm: true });
}
