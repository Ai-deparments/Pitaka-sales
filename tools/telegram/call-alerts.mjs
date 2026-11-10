#!/usr/bin/env node
// TZ §2.8, §7 — kritik qo'ng'iroq haqida rahbarga Telegram xabari.
//
// Nega alohida skript: tahlil tugagan zahoti Telegram'ga urinish web'ni sekinlashtiradi
// va Telegram ishlamay qolsa xabar butunlay yo'qoladi. Shuning uchun tahlil natijani
// `call_alerts` navbatiga qo'yadi, bu skript esa navbatni bo'shatadi. Yuborilgani
// `sent_at` bilan belgilanadi — bir qo'ng'iroq ikki marta xabar bermaydi.
//
//   node call-alerts.mjs           -> navbatdagilarni yuboradi
//   node call-alerts.mjs --dry     -> faqat ekranga chiqaradi
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const BASE = process.env.AI_AGENT_HOME || "/home/claude";
const APP = process.env.SOTUV_APP || `${BASE}/projects/sotuv-web`;
const BOT_ENV = process.env.BOT_ENV || `${BASE}/.claude-sotuv/channels/telegram/.env`;
const PANEL = String(process.env.PANEL_URL || "").replace(/\/+$/, "");   // bo'sh bo'lsa havola qatori chiqmaydi
const DRY = process.argv.includes("--dry");
const MAX = Number(process.env.ALERT_MAX || 10);
// Guruh: GROUP_CHAT_ID env, bo'lmasa bo'lim boshi agentining .env faylidagi GROUP_CHAT_ID (§7.4 kelishuvi).
// Ilgari bu yerda qattiq yozilgan -5550106577 turardi — u guruh Telegram'da yo'q, xabarlar yetmasdi.
// Faqat YANGI qo'ng'iroqlar uchun xabar: eski qo'ng'iroqlar tarixiy tahlildan o'tganda rahbarga
// oylar oldingi qo'ng'iroq haqida «KRITIK» ketmasin (natija panelda baribir ko'rinadi).
const MAX_AGE_H = Number(process.env.ALERT_MAX_AGE_H || 72);

const store = await import(`${APP}/lib/callstore.mjs`);
const db = new DatabaseSync(process.env.SOTUV_DB || path.join(APP, "data", "sotuv.db"));
// Web servisi ayni paytda shu bazaga yozayotgan bo'lishi mumkin — kutamiz,
// aks holda "database is locked" bilan yiqilamiz (sinovda shunday bo'ldi).
db.exec("PRAGMA busy_timeout = 8000;");
store.initCallSchema(db);

const RISK = { critical: "🔴 KRITIK", high: "🟠 Yuqori xavf" };
const URG = { critical: "kritik", high: "yuqori", medium: "o'rta", low: "past" };
const SENT = { positive: "ijobiy", neutral: "neytral", negative: "salbiy" };
const dt = (iso) => { try { const d = new Date(iso); const t = new Date(d.getTime() + (d.getTimezoneOffset() + 300) * 6e4);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(t.getDate())}.${p(t.getMonth() + 1)}.${t.getFullYear()} ${p(t.getHours())}:${p(t.getMinutes())}`; } catch { return "—"; } };
const dur = (s) => (s >= 60 ? `${Math.floor(s / 60)} daq ${s % 60} s` : `${s} s`);
const money = (n, c) => `${Number(n || 0).toLocaleString("ru-RU")} ${c || ""}`.trim();

function message(a) {
  const d = a.payload;
  const L = [];
  L.push(`${RISK[a.risk] || a.risk} — qo'ng'iroq tahlili`);
  L.push("");
  L.push(`👤 ${d.client || "mijoz noma'lum"}`);
  if (d.deal) L.push(`💼 ${d.deal.title || "bitim"} · ${d.deal.stage || ""}${d.deal.amount ? ` · ${money(d.deal.amount, d.deal.currency)}` : ""}`);
  L.push(`📞 ${dt(d.at)} · ${dur(d.durSec || 0)} · ${d.owner || "operator noma'lum"}`);
  if (d.topic) L.push(`🗒 ${d.topic}`);
  L.push("");
  L.push(`Ball: ${a.score ?? "—"}/100 · kayfiyat: ${SENT[d.sentiment] || "—"} · shoshilinchlik: ${URG[d.urgency] || "—"}`);
  if (d.reasons?.length) {
    L.push("");
    L.push("Nega xavfli:");
    for (const r of d.reasons) L.push(`  • ${r}`);
  }
  if (d.quote) {
    L.push("");
    L.push(`Mijoz aytdi (${d.quote.ts}):`);
    L.push(`  «${String(d.quote.text).slice(0, 220)}»`);
    if (d.quote.tip) L.push(`  ➜ ${d.quote.tip}`);
  }
  L.push("");
  L.push(d.next?.text ? `Keyingi qadam: ${d.next.text}${d.next.due ? ` (${d.next.due})` : ""}`
                      : "⚠️ Keyingi qadam belgilanmagan");
  L.push("");
  L.push(PANEL ? `Tahlil: ${PANEL}  →  Qo'ng'iroqlar → #${a.call_id}` : `Tahlil: panel → Qo'ng'iroqlar → #${a.call_id}`);
  L.push("");
  L.push("AI tavsiyasi — yakuniy qaror insonniki. Chora ko'rishdan oldin audioni eshiting.");
  return L.join("\n");
}

const navbat = store.pendingAlerts(db, 200);
const pending = [];
let eski = 0;
for (const a of navbat) {
  const at = Date.parse(a.payload?.at || "");
  if (Number.isFinite(at) && Date.now() - at > MAX_AGE_H * 3600e3) {
    // Tarixiy qo'ng'iroq — xabar yubormaymiz, lekin navbatdan chiqaramiz
    if (!DRY) store.markAlertSent(db, a.call_id, `eski qo'ng'iroq (${MAX_AGE_H} soatdan oldingi) — xabar yuborilmadi`);
    eski++; continue;
  }
  if (pending.length < MAX) pending.push(a);
}
if (eski) console.log(`${new Date().toISOString()} eski qo'ng'iroq ogohlantirishi o'tkazildi: ${eski}`);
if (!pending.length) { if (DRY) console.log("navbat bo'sh"); process.exit(0); }

if (DRY) {
  for (const a of pending) console.log("─".repeat(46) + "\n" + message(a));
  console.log(`\n(${pending.length} ta navbatda — sinov rejimi, yuborilmadi)`);
  process.exit(0);
}

const env = Object.fromEntries(fs.readFileSync(BOT_ENV, "utf8").split("\n")
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean)
  .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const token = env.TELEGRAM_BOT_TOKEN;
// Manzillar: rahbarning shaxsiy chati va sotuv guruhi (egasi ikkalasini tanladi).
// ALERT_CHAT_ID berilsa faqat o'sha ishlatiladi.
const chats = (process.env.ALERT_CHAT_ID
  ? [process.env.ALERT_CHAT_ID]
  : [env.OWNER_CHAT_ID, process.env.GROUP_CHAT_ID || env.GROUP_CHAT_ID]
).map((x) => String(x || "").trim()).filter(Boolean);
const uniq = [...new Set(chats)];
if (!token || !uniq.length) { console.error("TELEGRAM_BOT_TOKEN yoki chat ID topilmadi"); process.exit(1); }

const send = (chat, text) => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
}).then((r) => r.json()).catch((e) => ({ ok: false, description: e.message }));

let sent = 0, failed = 0;
for (const a of pending) {
  const text = message(a);
  const errs = [];
  let anyOk = false;
  for (const chat of uniq) {
    const j = await send(chat, text);
    if (j.ok) anyOk = true;
    else errs.push(`${chat}: ${j.description || JSON.stringify(j).slice(0, 120)}`);
  }
  // Kamida bittasiga yetgan bo'lsa "yuborilgan" deb belgilaymiz — aks holda
  // bitta noto'g'ri chat butun navbatni cheksiz takrorlashga majbur qiladi.
  store.markAlertSent(db, a.call_id, errs.length ? errs.join(" | ").slice(0, 300) : null);
  anyOk ? sent++ : failed++;
  if (errs.length) console.error(`  ${a.call_id}: ${errs.join(" | ")}`);
}
console.log(`${new Date().toISOString()} yuborildi: ${sent}, yetmadi: ${failed}, manzil: ${uniq.length}`);
process.exit(failed && !sent ? 1 : 0);
