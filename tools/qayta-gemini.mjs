// Groq bilan tahlil qilingan VoIP qo'ng'iroqlarini Gemini bilan QAYTA o'tkazish (force).
// Qo'lda tuzatish yo'q (tekshirilgan). Ketma-ket, orada 20 s — Gemini bepul tarif minut limiti uchun.
import fs from "node:fs"; import path from "node:path"; import { DatabaseSync } from "node:sqlite";
const APP = "/home/claude/projects/sotuv-web";
for (const f of ["/home/claude/secrets/bitrix-sotuv.env", path.join(APP, ".env"), "/home/claude/secrets/claude-oauth.env"]) {
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, "utf8").split("\n")) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
}
const { Bitrix } = await import(`${APP}/lib/bitrix.mjs`);
const calls = await import(`${APP}/lib/calls.mjs`);
const pipe = await import(`${APP}/lib/pipeline.mjs`);
const db = new DatabaseSync(path.join(APP, "data", "sotuv.db")); db.exec("PRAGMA busy_timeout = 8000;");
const bx = new Bitrix(process.env.BITRIX_WEBHOOK_URL, { timeoutMs: 60000 });
const IDS = process.argv.slice(2);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
for (const id of IDS) {
  try {
    const row = await calls.one(bx, db, id, { canSeePhone: true });
    if (!row) { log(id, "topilmadi"); continue; }
    const out = await pipe.processCall(bx, db, row, { force: true, actor: "gemini-qayta" });
    const a = db.prepare("SELECT score, risk, topic FROM call_analyses WHERE call_id=?").get(id) || {};
    log(id, `${row.dur}s`, out.failed ? `XATO ${out.stage}: ${String(out.why).slice(0, 120)}` : `ball ${a.score} · ${a.risk} · ${a.topic} · ${(out.steps || []).join(" → ").slice(0, 200)}`);
  } catch (e) { log(id, "XATO", String(e.message).slice(0, 160)); }
  await new Promise((r) => setTimeout(r, 20000));
}
log("tugadi");
process.exit(0);
