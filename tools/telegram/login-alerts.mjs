#!/usr/bin/env node
// Notanish tarmoqdan kirish haqida rahbarga Telegram ogohlantirishi.
//
// Nega alohida skript va login yo'liga tegilmagan: kirish so'rovi ichida Telegram'ga
// murojaat qilish login'ni sekinlashtiradi va Telegram ishlamay qolsa kirish ham
// osilib qolishi mumkin. Audit jurnali allaqachon har kirishni IP bilan yozadi —
// ya'ni u tayyor navbat vazifasini bajaradi, hech narsa yo'qolmaydi.
//
//   node login-alerts.mjs         -> yangi yozuvlarni tekshirib, kerakli xabarni yuboradi
//   node login-alerts.mjs --dry   -> yubormaydi, faqat ekranga chiqaradi
//   node login-alerts.mjs --since <id>  -> o'sha id dan boshlab qayta ko'rib chiqadi
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const BASE = process.env.AI_AGENT_HOME || "/home/claude";
const APP = process.env.SOTUV_APP || `${BASE}/projects/sotuv-web`;
const BOT_ENV = process.env.BOT_ENV || `${BASE}/.claude-sotuv/channels/telegram/.env`;
const DB_PATH = process.env.SOTUV_DB || path.join(APP, "data", "sotuv.db");
const STATE = process.env.ALERT_STATE || path.join(APP, "data", "login-alerts.json");
const DRY = process.argv.includes("--dry");
const sinceArg = process.argv.indexOf("--since");

// Tanish tarmoqlar — nginx ruxsat ro'yxati bilan bir xil bo'lishi kerak
// (81.85.51.135 — serverning o'zi, ichki so'rovlar shundan ko'rinadi).
// O'zgarsa shu yerni ham yangilang (yoki KNOWN_NETS muhit o'zgaruvchisi bilan bering).
const KNOWN = (process.env.KNOWN_NETS ||
  "81.85.51.135/32,127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16")
  .split(",").map((s) => s.trim()).filter(Boolean);

// Faqat xabarni boyitish uchun — bloklash uchun emas.
const LABELS = [
  [/^104\.(1[6-9]|2[0-9]|3[01])\./, "Cloudflare WARP / VPN"],
  [/^(3[45]|52|54|18)\./,           "bulut provayderi bo'lishi mumkin"],
];

const ip2n = (ip) => ip.split(".").reduce((a, o) => (a << 8 >>> 0) + (Number(o) & 255) >>> 0, 0) >>> 0;
function inCidr(ip, cidr) {
  const [net, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw ?? 32);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(net)) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ip2n(ip) & mask) >>> 0) === ((ip2n(net) & mask) >>> 0);
}
const known = (ip) => KNOWN.some((c) => inCidr(ip, c));
const labelFor = (ip) => (LABELS.find(([re]) => re.test(ip)) || [, "notanish tarmoq"])[1];

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return null; } };
const writeState = (s) => { fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); try { fs.chmodSync(STATE, 0o600); } catch {} };

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 8000;");

const maxId = db.prepare("SELECT COALESCE(MAX(id),0) AS m FROM audit_events").get().m;
let state = readState();
if (sinceArg > -1) state = { lastId: Number(process.argv[sinceArg + 1] || 0) };
if (!state) {
  // Birinchi ishga tushirish — eski tarixni to'kib tashlamaymiz.
  writeState({ lastId: maxId, startedAt: new Date().toISOString() });
  console.log(`birinchi ishga tushirish — kuzatuv id ${maxId} dan boshlanadi, eski yozuvlar yuborilmadi`);
  process.exit(0);
}

const rows = db.prepare(
  "SELECT id, actor, action, entity AS ip, at FROM audit_events " +
  "WHERE id > ? AND action = 'login.ok' ORDER BY id"
).all(state.lastId);

const suspicious = rows.filter((r) => r.ip && !known(r.ip));
console.log(`tekshirildi: ${rows.length} ta kirish, notanish: ${suspicious.length}`);

if (!suspicious.length) {
  if (!DRY) writeState({ ...state, lastId: maxId, checkedAt: new Date().toISOString() });
  process.exit(0);
}

const message = (r) => [
  "🔐 Notanish tarmoqdan kirish",
  "",
  `Hisob:  ${r.actor}`,
  `IP:     ${r.ip}  (${labelFor(r.ip)})`,
  `Vaqt:   ${r.at}`,
  "",
  "Bu siz bo'lmasangiz — parolni darhol almashtiring:",
  "  node server.mjs passwd " + r.actor,
  "va barcha sessiyalarni yoping.",
].join("\n");

if (DRY) {
  for (const r of suspicious) console.log("\n----\n" + message(r));
  process.exit(0);
}

const env = Object.fromEntries(
  fs.readFileSync(BOT_ENV, "utf8").split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)).filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")])
);
const token = env.TELEGRAM_BOT_TOKEN;
// Xavfsizlik xabari — faqat rahbarning shaxsiy chatiga, guruhga emas.
const chat = process.env.ALERT_CHAT_ID || env.OWNER_CHAT_ID;
if (!token || !chat) { console.error("TELEGRAM_BOT_TOKEN yoki OWNER_CHAT_ID topilmadi"); process.exit(1); }

let sent = 0;
for (const r of suspicious) {
  const j = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: message(r), disable_web_page_preview: true }),
  }).then((x) => x.json()).catch((e) => ({ ok: false, description: e.message }));
  if (j.ok) sent++;
  else console.error(`  ${r.id}: ${j.description || "yuborilmadi"}`);
}
// Yuborilmagan bo'lsa ham oldinga suramiz — aks holda bitta xato xabar
// har daqiqada qayta-qayta urinib, navbatni tiqilib qoldiradi.
writeState({ ...state, lastId: maxId, checkedAt: new Date().toISOString() });
console.log(`yuborildi: ${sent}/${suspicious.length}`);
