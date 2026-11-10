#!/usr/bin/env node
// Tezkor javob — agent uchun CLI: panel bilan bir xil raqam, oyna va kesim vaqti (model hisoblamaydi).
//   node tools/tezkor-cli.mjs "Kecha nechta lid keldi?"
// Chiqish kodi: 0 — javob bor (stdout); 2 — bu savol tezkor emas yoki ma'lumot to'liq emas → agent
// odatdagi yo'l bilan ishlaydi; 1 — savol berilmagan.
// Faqat o'qiydi: CRM — GET (adapter), panel bazasi — readOnly.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const APP = process.env.SOTUV_APP || "/home/claude/projects/sotuv-web";
const lib = (f) => import(pathToFileURL(path.join(APP, "lib", f)).href);

const savol = process.argv.slice(2).join(" ").trim();
if (!savol) { console.error('Foydalanish: tezkor.sh "<savol>"'); process.exit(1); }

const [{ Bitrix }, api, hyg, sla, calls, rng, tezkor] = await Promise.all(
  ["bitrix.mjs", "api.mjs", "hygiene.mjs", "sla.mjs", "calls.mjs", "range.mjs", "tezkor.mjs"].map(lib));
const bx = new Bitrix(process.env.BITRIX_WEBHOOK_URL || "http://127.0.0.1:8099/rest/1/demo/");

let db = null;
try { db = new DatabaseSync(process.env.SOTUV_DB || path.join(APP, "data", "sotuv.db"), { readOnly: true }); } catch { /* reja va hisoblar javobsiz qoladi */ }
const sql = (q) => { try { return db?.prepare(q).get() ?? null; } catch { return null; } };

const ctx = {
  leads: (R, limit) => api.leads(bx, { range: R, semantic: null, status: null, limit, owner: null, operator: null }),
  overview: () => hyg.overview(bx, rng.normalize(30)),
  javobsiz24: () => sla.slaCheck(bx, null, rng.rolling(30)).then((x) => x?.totals?.atRisk ?? null),
  plan: () => {
    const v = sql("SELECT value, updated_at FROM settings WHERE key='plan_month'");
    return db ? { plan: Number(v?.value || 0), updatedAt: v?.updated_at || null } : null;
  },
  calls: (R) => calls.calls(bx, R, null),
  users: () => Number(sql("SELECT COUNT(*) AS n FROM users")?.n ?? NaN),
};

try {
  const r = await tezkor.javob(savol, ctx);
  if (!r) process.exit(2);
  console.log(r.text);
  process.exit(0);
} catch (e) {
  console.error(`tezkor: ${e.message}`);
  process.exit(2);
}
