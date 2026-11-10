#!/usr/bin/env node
// Xavfsizlik qo'riqchisining Telegram ogohlantirishi.
//
// Ikki rejim:
//   node qoriqchi-alerts.mjs            -> faqat O'ZGARISH haqida xabar beradi
//   node qoriqchi-alerts.mjs --digest   -> to'liq kunlik hisobot
//   ... --dry                            -> yubormaydi, ekranga chiqaradi
//
// Nega faqat o'zgarish: 2FA yo'qligi haftalar davomida qizil turadi. Har 15
// daqiqada shu haqda xabar kelsa, odam bir kunda ogohlantirishni o'chirib
// qo'yadi va keyin HAQIQIY hodisani ham ko'rmaydi. Shuning uchun takroriy
// holat jim, faqat yangi yoki og'irlashgan muammo ovoz chiqaradi.
//
// Yaxshilanish ham xabar qilinadi ("hal bo'ldi") — aks holda odam muammo
// tuzalganini bilmay, keraksiz ish qilib yuradi.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { report, textReport, RANK } from "../../lib/qoriqchi.mjs";

const BASE = process.env.AI_AGENT_HOME || "/home/claude";
const APP = process.env.SOTUV_APP || `${BASE}/projects/sotuv-web`;
// Qalqonning o'z boti bo'lsa — o'shandan yuboriladi (xavfsizlik xabari xavfsizlik
// botidan kelgani mantiqiy). Bo'lmasa sotuv botiga qaytadi, ya'ni bot o'rnatilmagan
// kunlarda ham ogohlantirish yo'qolmaydi.
const BOT_ENV = process.env.BOT_ENV
  || [`${BASE}/secrets/telegram-qoriqchi.env`, `${BASE}/.claude-sotuv/channels/telegram/.env`]
       .find((p) => { try { fs.accessSync(p); return true; } catch { return false; } })
  || `${BASE}/.claude-sotuv/channels/telegram/.env`;
const DB_PATH = process.env.SOTUV_DB || path.join(APP, "data", "sotuv.db");
const STATE = process.env.QORIQCHI_STATE || path.join(APP, "data", "qoriqchi-state.json");
const DRY = process.argv.includes("--dry");
const DIGEST = process.argv.includes("--digest");

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return null; } };
const writeState = (s) => {
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2));
  try { fs.chmodSync(STATE, 0o600); } catch {}
};

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 8000;");
const rep = await report(db);
const now = Object.fromEntries(rep.checks.map((c) => [c.id, c.status]));

let state = readState();
if (!state) {
  // Birinchi ishga tushirish: mavjud holatni asos qilib olamiz va JIM turamiz.
  // Aks holda o'rnatilgan zahoti barcha eski muammo bo'yicha xabar yog'iladi.
  writeState({ statuses: now, since: new Date().toISOString() });
  console.log(`birinchi ishga tushirish — ${rep.checks.length} ta tekshiruv holati saqlandi, xabar yuborilmadi`);
  console.log(textReport(rep));
  process.exit(0);
}

const ICON = { crit: "🔴", warn: "🟡", ok: "🟢", info: "⚪" };
const worseThan = (a, b) => RANK[a] > RANK[b];

const grew = [], healed = [];
for (const c of rep.checks) {
  const was = state.statuses?.[c.id] ?? "ok";
  if (worseThan(c.status, was)) grew.push({ c, was });
  else if (worseThan(was, c.status) && was !== "info") healed.push({ c, was });
}

function changeMessage() {
  const L = ["🛡 Qo'riqchi — holat o'zgardi", ""];
  for (const { c, was } of grew) {
    L.push(`${ICON[c.status]} ${c.title}`);
    L.push(`   ${c.summary}`);
    for (const it of (c.items || []).filter((i) => i.bad).slice(0, 3)) L.push(`   · ${it.label}: ${it.value}`);
    if (c.fix) L.push(`   → ${String(c.fix).split("\n")[0]}`);
    L.push(`   (avval: ${was})`);
    L.push("");
  }
  for (const { c } of healed) L.push(`🟢 Hal bo'ldi — ${c.title}: ${c.summary}`);
  if (healed.length) L.push("");
  L.push(`Umumiy ball: ${rep.score}/100 · ${rep.headline}`);
  L.push(`Panel: https://${rep.host}/ → Qo'riqchi`);
  return L.join("\n");
}

const text = DIGEST ? textReport(rep, { full: true }) : changeMessage();
const shouldSend = DIGEST || grew.length || healed.length;

if (!shouldSend) {
  writeState({ ...state, statuses: now, checkedAt: new Date().toISOString() });
  console.log(`o'zgarish yo'q (ball ${rep.score}, jiddiy ${rep.counts.crit}, e'tibor ${rep.counts.warn})`);
  process.exit(0);
}

if (DRY) {
  console.log(text);
  console.log(`\n--- (dry: yuborilmadi; o'sgan ${grew.length}, tuzalgan ${healed.length})`);
  process.exit(0);
}

const env = Object.fromEntries(
  fs.readFileSync(BOT_ENV, "utf8").split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
);
const token = env.TELEGRAM_BOT_TOKEN;
// Xavfsizlik xabari — SHAXSIY chatlarga, guruhga emas. Guruhda 14 kishi bor va
// hisobot qaysi hisobda 2FA yo'qligini, qaysi port ochiqligini ko'rsatadi —
// bu ichkaridagi odam uchun tayyor xarita bo'lardi.
const chats = String(process.env.ALERT_CHAT_ID || env.ALERT_CHAT_IDS || env.OWNER_CHAT_ID || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
if (!token || !chats.length) { console.error("TELEGRAM_BOT_TOKEN yoki chat id topilmadi"); process.exit(1); }

const results = [];
for (const chat of chats) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true }),
  }).then((x) => x.json()).catch((e) => ({ ok: false, description: e.message }));
  results.push([chat, r]);
  // "chat not found" — odam hali botga Start bosmagan. Bu xato emas, holat:
  // bot foydalanuvchiga u Start bosmaguncha yoza olmaydi.
  if (!r.ok) console.error(`  ${chat}: ${r.description}`);
}
const j = { ok: results.some(([, r]) => r.ok), description: results.map(([c, r]) => `${c}:${r.ok ? "ok" : r.description}`).join(" · ") };

// Yuborilmasa ham holatni saqlaymiz: aks holda bitta xato xabar har 15 daqiqada
// qayta-qayta urinib, navbatni tiqilib qoldiradi (login-alerts'da shu saboq bo'lgan).
writeState({ ...state, statuses: now, checkedAt: new Date().toISOString(), lastSent: j.ok ? new Date().toISOString() : state.lastSent });
console.log(`${j.ok ? "yuborildi" : "YUBORILMADI"} (o'sgan ${grew.length}, tuzalgan ${healed.length}) — ${j.description}`);
process.exit(j.ok ? 0 : 1);
