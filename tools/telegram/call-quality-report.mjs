#!/usr/bin/env node
// TZ §7 — kunlik "Qo'ng'iroq sifati" hisoboti sotuv guruhiga.
//
// Nega kerak: panel sifatni ko'rsatadi, lekin uni ochib qaraydigan odam kerak.
// Kunlik xabar buni o'zgartiradi. "Uch qoida" hisoboti bilan bir xil uslub.
//
//   node call-quality-report.mjs         -> guruhga yuboradi
//   node call-quality-report.mjs --dry   -> faqat ekranga
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const BASE = process.env.AI_AGENT_HOME || "/home/claude";
const APP = process.env.SOTUV_APP || `${BASE}/projects/sotuv-web`;
const BOT_ENV = process.env.BOT_ENV || `${BASE}/.claude-sotuv/channels/telegram/.env`;
// Guruh: GROUP_CHAT_ID env, bo'lmasa BOT_ENV (bo'lim boshi agenti) dagi GROUP_CHAT_ID.
// Ilgari qattiq yozilgan -5550106577 — Telegram'da yo'q guruh edi.
let GROUP = process.env.GROUP_CHAT_ID || "";
const PANEL = process.env.PANEL_URL || "https://sotuv.81-85-51-135.sslip.io";
const DAYS = Number(process.env.REPORT_DAYS || 7);
const DRY = process.argv.includes("--dry");

for (const f of [`${BASE}/secrets/bitrix-sotuv.env`, path.join(APP, ".env")]) {
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const { Bitrix } = await import(`${APP}/lib/bitrix.mjs`);
const calls = await import(`${APP}/lib/calls.mjs`);
const store = await import(`${APP}/lib/callstore.mjs`);
const db = new DatabaseSync(process.env.SOTUV_DB || path.join(APP, "data", "sotuv.db"));
// Web servisi ayni paytda shu bazaga yozayotgan bo'lishi mumkin — kutamiz,
// aks holda "database is locked" bilan yiqilamiz (sinovda shunday bo'ldi).
db.exec("PRAGMA busy_timeout = 8000;");
store.initCallSchema(db);
const bx = new Bitrix(process.env.BITRIX_WEBHOOK_URL, { timeoutMs: 30000 });

const [q, kpi] = await Promise.all([
  calls.leaderQuality(bx, db, { range: DAYS }),
  calls.qualityKpi(bx, db, { range: DAYS }),
]);

const bar = (pct) => { const n = Math.round(Math.max(0, Math.min(100, pct)) / 10); return "█".repeat(n) + "░".repeat(10 - n); };
const L = [];
L.push("📞 QO'NG'IROQ SIFATI — kunlik holat");
L.push(`Davr: ${kpi.range.label} (${DAYS} kun)`);
L.push("");

if (!q.analyzed) {
  L.push(`Bu davrda ${kpi.calls} ta qo'ng'iroq bo'lgan, lekin biror tahlil qilinmagan.`);
  L.push(kpi.recordings.downloadable
    ? "Panelda «Audiodan transkript olish» tugmasi bilan boshlash mumkin."
    : "Audio hali olinmaydi — Bitrix webhook'ida «Телефония» ruxsati kerak.");
} else {
  L.push(`Tahlil qilingan: ${q.analyzed} / ${kpi.analyzable} ta suhbat`);
  if (q.analyzed < 5) L.push("⚠️ Namuna kichik — o'rtacha ko'rsatkichlar hali ishonchsiz.");
  L.push(`O'rtacha ball: ${q.avgScore}/100  ${bar(q.avgScore)}`);
  L.push(`Ijobiy yakunlangan: ${kpi.positivePct ?? "—"}%`);
  L.push("");
  const crit = q.critical.filter((c) => !c.reviewed);
  L.push(crit.length ? `🔴 Ko'rilmagan kritik holat: ${crit.length} ta` : "✅ Kritik holatlar ko'rib chiqilgan");
  for (const c of crit.slice(0, 3))
    L.push(`   • ${(c.title || "mijoz noma'lum").slice(0, 34)} — ${c.ownerName} (ball ${c.score})`);
  if (kpi.promisedNoTask) L.push(`⚠️ Va'da berilgan, vazifa yaratilmagan: ${kpi.promisedNoTask} ta`);
  if (kpi.noNextStep) L.push(`⚠️ Keyingi qadam belgilanmagan: ${kpi.noNextStep} ta`);
  L.push("");
  // "Eng kuchli" faqat haqiqatan kuchli bo'lsa ko'rsatiladi — 40% ni ✅ bilan
  // belgilash rahbarni chalg'itadi (leaderQuality faqat tartiblab beradi).
  const strong = q.criteria.filter((c) => c.pct >= 70).slice(0, 3);
  const weak = q.criteria.filter((c) => c.pct < 70).slice(-3).reverse();
  if (weak.length) {
    L.push("Eng zaif mezonlar:");
    for (const w of weak) L.push(`  🔻 ${w.label} — ${w.pct}%`);
  }
  if (strong.length) {
    L.push("Eng kuchli:");
    for (const b of strong) L.push(`  ✅ ${b.label} — ${b.pct}%`);
  }
  if (q.owners.length) {
    L.push("");
    L.push("Operatorlar:");
    for (const o of q.owners.slice(0, 6))
      L.push(`  • ${o.ownerName} — ${o.avg}/100 (${o.n} tahlil${o.critical ? `, ${o.critical} kritik` : ""})`);
  }
  if (kpi.topObjections?.length) {
    L.push("");
    L.push(`Eng ko'p e'tiroz: ${kpi.topObjections.slice(0, 3).map((o) => `${o.text} (${o.n})`).join(" · ")}`);
  }
}
L.push("");
L.push(`Batafsil: ${PANEL} → Qo'ng'iroqlar → AI tahlil`);
if (!q.namesResolved) L.push("(Ismlar o'rniga ID — Bitrix'da «Пользователи» ruxsati yoqilmagan)");
L.push("");
L.push("AI tavsiyasi — yakuniy qaror insonniki. Ball dalilga asoslangan, lekin audiosiz chora ko'rilmasin.");

const text = L.join("\n");
if (DRY) { console.log(text); process.exit(0); }

const env = Object.fromEntries(fs.readFileSync(BOT_ENV, "utf8").split("\n")
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
  .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const token = env.TELEGRAM_BOT_TOKEN;
if (!token) { console.error("TELEGRAM_BOT_TOKEN topilmadi"); process.exit(1); }
GROUP = GROUP || env.GROUP_CHAT_ID || "";
if (!GROUP) { console.error("GROUP_CHAT_ID topilmadi (bo'lim boshi agentining .env faylida)"); process.exit(1); }
const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ chat_id: GROUP, text, disable_web_page_preview: true }),
});
const j = await res.json().catch(() => ({}));
console.log(new Date().toISOString(), j.ok ? `yuborildi (tahlil ${q.analyzed}, o'rtacha ${q.avgScore})` : `XATO: ${JSON.stringify(j).slice(0, 200)}`);
process.exit(j.ok ? 0 : 1);
