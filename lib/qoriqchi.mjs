// Xavfsizlik qo'riqchisi — panel o'z himoyasini o'zi o'lchaydi.
//
// Nega kerak: shu paytgacha himoya haqidagi bilim odamning boshida va xotira
// fayllarida turardi — ya'ni biror narsa buzilsa, kimdir qo'lda tekshirmaguncha
// bilinmasdi. Ikki marta shunga tushilgan: (1) deploy serverda qo'lda qilingan
// nginx o'zgarishini bosib ketgan, (2) baza fayli 644 rejimda oylab turgan.
// Bu modul ikkalasini ham o'lchov bilan ushlaydi.
//
// Ikkita qat'iy qoida:
//   1. FAQAT O'QIYDI. Bironta ham tekshiruv hech narsani o'zgartirmaydi.
//      Tuzatish buyrug'i matn sifatida beriladi — uni odam ko'rib turib bajaradi.
//   2. O'lchay olmasa — YOLG'ON GAPIRMAYDI. Log ochilmasa "muammo yo'q" demaydi,
//      "o'lchanmadi" deydi va nega ochilmaganini aytadi. Ko'rinmagan narsa
//      "yaxshi" degani emas.
//
// Bahodan oldin dalil: har tekshiruv `items` da aniq qatorlarni qaytaradi
// (qaysi hisob, qaysi IP, qaysi fayl), shuning uchun natijani tekshirib bo'ladi.
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "..");
const BASE = process.env.AI_AGENT_HOME || "/home/claude";

export const CFG = {
  host: process.env.SOTUV_HOST || "sotuv.81-85-51-135.sslip.io",
  appPort: Number(process.env.PORT || 8090),
  app: APP,
  secrets: `${BASE}/secrets`,
  backups: `${BASE}/backups/sotuv-web`,
  botEnv: `${BASE}/.claude-sotuv/channels/telegram/.env`,
  nginxAllow: process.env.NGINX_ALLOW || "/etc/caddy/sites/sotuv-allow.caddy",
  nginxSite: process.env.NGINX_SITE || "/etc/caddy/sites/sotuv.caddy",
  nginxLog: process.env.NGINX_LOG || "/var/log/caddy/sotuv-access.log",
  manifest: `${BASE}/secrets/brand-manifest.sha256`,
  selfIp: process.env.SERVER_IP || "81.85.51.135",
};

export const GROUPS = [
  { id: "kirish", title: "Kirish va hisoblar" },
  { id: "hujum", title: "Hujum belgilari" },
  { id: "server", title: "Server va sozlama" },
  { id: "butunlik", title: "Ma'lumot va butunlik" },
];

// crit — hozir zarar keltirishi mumkin; warn — himoya zaif; info — o'lchanmadi.
export const RANK = { ok: 0, info: 1, warn: 2, crit: 3 };
const worst = (list) => list.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");

// ---------- kichik yordamchilar ----------
const readText = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const statOf = (p) => { try { return fs.statSync(p); } catch { return null; } };
const modeOf = (s) => (s ? (s.mode & 0o777) : null);
const oct = (m) => (m === null ? "?" : m.toString(8).padStart(3, "0"));
const days = (ms) => Math.floor(ms / 864e5);
const agoDays = (iso) => (iso ? days(Date.now() - new Date(String(iso).replace(" ", "T") + "Z").getTime()) : null);

// Faylning oxirgi qismini o'qiydi — 600 MB log ni xotiraga tortmaslik uchun.
function tailFile(p, bytes = 512 * 1024) {
  const fd = fs.openSync(p, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally { fs.closeSync(fd); }
}

// ---------- tarmoq ro'yxati ----------
const ip2n = (ip) => ip.split(".").reduce((a, o) => ((a << 8) >>> 0) + (Number(o) & 255) >>> 0, 0) >>> 0;
function inCidr(ip, cidr) {
  const [net, bitsRaw] = String(cidr).split("/");
  const bits = Number(bitsRaw ?? 32);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+\.\d+\.\d+\.\d+$/.test(net)) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ip2n(ip) & mask) >>> 0) === ((ip2n(net) & mask) >>> 0);
}

// Tanish tarmoqlar ro'yxati NGINX KONFIGIDAN olinadi, qo'lda takrorlanmaydi.
// Sabab: ilgari ro'yxat ikki joyda turardi (nginx + ogohlantirish skripti) va
// biri o'zgarganda ikkinchisi eskirib qolardi. Endi manba bitta.
export function gateState() {
  const g = { readable: false, active: false, nets: [], basic: false, satisfyAny: false, source: CFG.nginxAllow };
  const snip = readText(CFG.nginxAllow);
  if (snip !== null) {
    g.readable = true;
    for (const line of snip.split("\n")) {
      const t = line.trim();
      if (t.startsWith("#")) continue;
      // nginx: allow X; satisfy any; auth_basic "..."   |   Caddy: @tanish remote_ip X · basic_auth { ... }
      const m = t.match(/^allow\s+([^;]+);/) || t.match(/remote_ip\s+(.+)$/);
      if (m) g.nets.push(m[1].replace(/[;{}]/g, "").trim());
      if (/^satisfy\s+any\s*;/.test(t) || /^@\w+\s+not\s+remote_ip/.test(t)) g.satisfyAny = true;
      if (/^auth_basic\s+"/.test(t) || /^basic_auth\b/.test(t)) g.basic = true;
    }
  }
  const site = readText(CFG.nginxSite);
  if (site !== null) {
    // nginx: `include .../sotuv-allow.conf;`  |  Caddy: `import /etc/caddy/sotuv-allow.snippet*`
    g.active = site.split("\n").some((l) => {
      const t = l.trim();
      return !t.startsWith("#") && /sotuv-allow\.(conf|snippet)/.test(t) && !t.startsWith("#include");
    });
  }
  return g;
}

// Kirish IP si "tanish"mi. nginx ro'yxati + serverning o'zi + ichki tarmoqlar.
function knownNets() {
  const g = gateState();
  const extra = ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", `${CFG.selfIp}/32`];
  const fromEnv = (process.env.KNOWN_NETS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return { nets: [...new Set([...g.nets, ...fromEnv, ...extra])], gate: g };
}

// ================== TEKSHIRUVLAR ==================
// Har biri { status, summary, items?, fix?, meta? } qaytaradi.

const LEAD_ROLES = ["ega", "ceo", "rahbar", "admin"];

function mfaRequired(db) {
  try {
    const r = db.prepare("SELECT v FROM app_settings WHERE k = 'mfa_required'").get();
    return r && r.v === "1";
  } catch { return false; }
}

// --- 1. Ikki bosqichli kirish qamrovi ---
function chkMfa({ db, gate }) {
  const users = db.prepare("SELECT login, role, totp_enabled FROM users ORDER BY login").all();
  const req = mfaRequired(db);
  const leadOff = users.filter((u) => LEAD_ROLES.includes(u.role) && !u.totp_enabled);
  const anyOff = users.filter((u) => !u.totp_enabled);
  const items = users.map((u) => ({
    label: `${u.login} (${u.role})`,
    value: u.totp_enabled ? "2FA bor" : "2FA YO'Q",
    bad: !u.totp_enabled,
  }));
  items.push({ label: "Majburiy 2FA sozlamasi", value: req ? "yoqilgan" : "o'chiq", bad: !req });

  // Darvoza ochiq bo'lsa parol yagona to'siq bo'lib qoladi — shuning uchun
  // 2FA yo'qligi o'sha holatda ancha jiddiyroq.
  const openToWorld = !(gate.active && gate.nets.length);
  let status = "ok", summary = `${users.length} hisobning hammasida 2FA yoqilgan`;
  if (leadOff.length) {
    status = "crit";
    summary = `${leadOff.length} ta rahbar hisobida 2FA yo'q` + (openToWorld ? " — panel esa internetga ochiq" : "");
  } else if (anyOff.length) {
    status = "warn";
    summary = `${anyOff.length} ta hisobda 2FA yo'q`;
  }
  return {
    status, summary, items,
    fix: "Har bir xodim panelga kirib, chap pastdagi Profil (ism/rol bloki yoki odam belgisi) → " +
      "\"Ikki bosqichli kirish\" → \"Sozlashni boshlash\" orqali 2FA ni yoqsin. " +
      "Hamma yoqqandan keyin majburiy qilish (serverda): node server.mjs mfareq on",
    meta: { total: users.length, off: anyOff.length, leadOff: leadOff.length, required: req },
  };
}

// --- 2. Hisoblar: kim bor, kim ishlatmayapti, kim yaratgan ---
function chkHisob({ db }) {
  const users = db.prepare("SELECT login, role, created_at FROM users ORDER BY login").all();
  const lastLogin = new Map(
    db.prepare("SELECT actor, MAX(at) last FROM audit_events WHERE action='login.ok' GROUP BY actor")
      .all().map((r) => [r.actor, r.last]),
  );
  const items = [];
  let stale = 0, never = 0;
  for (const u of users) {
    const last = lastLogin.get(u.login) || null;
    const d = last ? agoDays(last) : null;
    if (!last) never++; else if (d > 45) stale++;
    items.push({
      label: `${u.login} (${u.role})`,
      value: last ? `oxirgi kirish ${d} kun oldin` : "hech qachon kirmagan",
      bad: !last || d > 45,
    });
  }
  // Hisob ustidagi amallar — "kim yaratgan" savoliga javob shu yerda.
  // (Bir marta "test" hisobi buzib kirish deb o'ylangan; jurnalni o'qigach
  //  uni egasining o'zi yaratgani ma'lum bo'lgan. Shu sabab actor ko'rsatiladi.)
  const changes = db.prepare(
    "SELECT actor, action, entity, detail, at FROM audit_events " +
    "WHERE action IN ('user.create','user.add','user.role','user.delete','user.rename') " +
    "AND at >= datetime('now','-30 day') ORDER BY id DESC LIMIT 20",
  ).all();
  const status = never || stale ? "warn" : "ok";
  return {
    status,
    summary: never || stale
      ? `${never} ta hisob hech qachon ishlatilmagan, ${stale} tasi 45 kundan beri jim`
      : `${users.length} hisobning hammasi faol`,
    items,
    extra: changes.length
      ? { title: "Oxirgi 30 kunda hisoblar ustidagi amallar", rows: changes.map((c) => `${c.at} · ${c.actor} → ${c.action} ${c.entity || ""} ${c.detail || ""}`.trim()) }
      : null,
    fix: "Ishlatilmayotgan hisobni o'chiring: panel → Xodimlar → o'chirish. " +
      "Ro'yxatdagi har bir amalni tanidingizmi — tanimasangiz o'sha hisobning parolini darhol tiklang.",
    meta: { total: users.length, never, stale, changes: changes.length },
  };
}

// --- 3. Sessiyalar ---
function chkSessiya({ db }) {
  const now = Date.now();
  const rows = db.prepare(
    "SELECT s.token, s.expires_at, s.created_at, u.login FROM sessions s JOIN users u ON u.id = s.user_id",
  ).all();
  const live = rows.filter((r) => r.expires_at > now);
  const dead = rows.length - live.length;
  const TTL_H = 12;
  const tooLong = live.filter((r) => (now - new Date(String(r.created_at).replace(" ", "T") + "Z").getTime()) > (TTL_H + 1) * 3600e3);
  const perUser = {};
  for (const r of live) perUser[r.login] = (perUser[r.login] || 0) + 1;
  const many = Object.entries(perUser).filter(([, n]) => n > 5);
  const items = Object.entries(perUser).map(([login, n]) => ({ label: login, value: `${n} ta ochiq sessiya`, bad: n > 5 }));
  if (!live.length) items.push({ label: "Ochiq sessiya", value: "yo'q", bad: false });
  if (dead) items.push({ label: "Muddati o'tgan yozuv", value: `${dead} ta (tozalanmagan)`, bad: false });

  let status = "ok";
  if (tooLong.length) status = "crit";
  else if (many.length) status = "warn";
  return {
    status,
    summary: tooLong.length
      ? `${tooLong.length} ta sessiya ${TTL_H} soatlik muddatdan oshib ketgan`
      : `${live.length} ta ochiq sessiya`,
    items,
    fix: "Shubha bo'lsa hamma sessiyani yoping: panel → Xavfsizlik → \"Barcha qurilmalardan chiqish\" " +
      "(yoki POST /api/logout-all).",
    meta: { live: live.length, dead, tooLong: tooLong.length },
  };
}

// --- 4. Parol yoshi ---
function chkParol({ db }) {
  const users = db.prepare("SELECT login, created_at FROM users").all();
  const rot = new Map(
    db.prepare(
      "SELECT COALESCE(entity, actor) who, MAX(at) last FROM audit_events " +
      "WHERE action IN ('user.passwd','password.rotate') GROUP BY who",
    ).all().map((r) => [r.who, r.last]),
  );
  const items = [];
  let old = 0, veryOld = 0;
  for (const u of users) {
    const last = rot.get(u.login) || u.created_at;
    const d = agoDays(last);
    if (d > 365) veryOld++; else if (d > 180) old++;
    items.push({ label: u.login, value: `parol ${d} kun oldin o'rnatilgan`, bad: d > 180 });
  }
  return {
    status: veryOld ? "warn" : old ? "warn" : "ok",
    summary: veryOld || old
      ? `${veryOld + old} ta hisobda parol ${old && !veryOld ? "180" : "365"} kundan eski`
      : "Barcha parollar yaqinda yangilangan",
    items,
    fix: "Panel → Xodimlar → parolni tiklash. Yangi parol bir marta ko'rsatiladi — " +
      "uni chatga yoki xat ichiga tashlamang.",
    meta: { old, veryOld },
  };
}

// --- 5. Kirish urinishlari (brute force) ---
function chkBrut({ db }) {
  const q = (sql, ...a) => db.prepare(sql).get(...a);
  const f24 = q("SELECT COUNT(*) c FROM audit_events WHERE action='login.fail' AND at >= datetime('now','-1 day')").c;
  const f7 = q("SELECT COUNT(*) c FROM audit_events WHERE action='login.fail' AND at >= datetime('now','-7 day')").c;
  const ok24 = q("SELECT COUNT(*) c FROM audit_events WHERE action='login.ok' AND at >= datetime('now','-1 day')").c;
  const byIp = db.prepare(
    "SELECT entity ip, COUNT(*) c FROM audit_events WHERE action='login.fail' " +
    "AND at >= datetime('now','-7 day') GROUP BY entity ORDER BY c DESC LIMIT 8",
  ).all();
  const byLogin = db.prepare(
    "SELECT actor, COUNT(*) c FROM audit_events WHERE action='login.fail' " +
    "AND at >= datetime('now','-7 day') GROUP BY actor ORDER BY c DESC LIMIT 8",
  ).all();
  const now = Date.now();
  const locked = db.prepare("SELECT scope, fails, locked_until FROM login_attempts WHERE locked_until > ?").all(now);
  const armed = db.prepare("SELECT scope, fails FROM login_attempts WHERE fails >= 4 AND locked_until <= ?").all(now);

  const items = [
    { label: "Xato urinish (24 soat)", value: String(f24), bad: f24 >= 10 },
    { label: "Xato urinish (7 kun)", value: String(f7), bad: false },
    { label: "Muvaffaqiyatli kirish (24 soat)", value: String(ok24), bad: false },
    ...locked.map((l) => ({ label: `QULFLANGAN: ${l.scope}`, value: `${l.fails} urinish, ${Math.ceil((l.locked_until - now) / 60000)} daq qoldi`, bad: true })),
    ...armed.map((l) => ({ label: `Qulf yoqasida: ${l.scope}`, value: `${l.fails} urinish`, bad: true })),
    // Bu ikkisi TARIX — holat emas. Qizil qilib belgilamaymiz, aks holda allaqachon
    // hal bo'lgan (qulfi ochilgan) hodisa panelda abadiy qizil bo'lib turaveradi.
    ...byIp.filter((r) => r.ip).map((r) => ({ label: `IP ${r.ip}`, value: `${r.c} xato (7 kun)`, bad: false })),
    ...byLogin.map((r) => ({ label: `login "${r.actor}"`, value: `${r.c} xato (7 kun)`, bad: false })),
  ];
  // Ikki butunlay boshqa hodisa bitta raqamga o'xshab ko'rinadi:
  //   (a) xodim o'z parolini eslay olmayapti — MAVJUD hisobga ko'p urinish, kirish yo'q
  //   (b) kimdir parol tanlayapti      — MAVJUD BO'LMAGAN loginlarga urinish
  // Ularni bir xil "ko'p xato urinish" deb ko'rsatish foydasiz: chora ham, shoshilinchligi
  // ham har xil. Shuning uchun loginni foydalanuvchilar ro'yxati bilan solishtiramiz.
  const known = new Set(db.prepare("SELECT login FROM users").all().map((r) => r.login));
  // Kirish oynasi 2 kun: 7 kun deb olsak, bir hafta oldin kirgan-u shu kundan beri
  // kira olmayotgan xodim "muammosiz" bo'lib ko'rinadi va e'tibordan chetda qoladi.
  const okLogins = new Set(db.prepare(
    "SELECT DISTINCT actor FROM audit_events WHERE action='login.ok' AND at >= datetime('now','-2 day')",
  ).all().map((r) => r.actor));
  const stuck = byLogin.filter((r) => known.has(r.actor) && r.c >= 3 && !okLogins.has(r.actor));
  const probing = byLogin.filter((r) => !known.has(r.actor));
  // Parol tanlash HAJM bilan bilinadi, nomlar soni bilan emas. Bir-ikkita noto'g'ri
  // login — bu odam o'z loginini xato yozgani (masalan "admn" / "admin1"). Buni
  // hujum deb ko'rsatish qo'riqchiga bo'lgan ishonchni yo'q qiladi.
  const probingTotal = probing.reduce((a, r) => a + r.c, 0);
  for (const r of stuck) items.push({ label: `KIRA OLMAYAPTI: ${r.actor}`, value: `${r.c} urinish (7 kun), 2 kundan beri kira olmagan`, bad: true });
  for (const r of probing.slice(0, 5)) items.push({
    label: `Mavjud bo'lmagan login: ${r.actor}`, value: `${r.c} urinish`,
    bad: probingTotal >= 8,
  });

  const heavy = byIp.some((r) => r.c >= 30);
  let status = "ok", summary = `24 soatda ${f24} ta xato urinish — odatiy`;
  let fix = "Chora talab qilinmaydi.";
  if (locked.length || heavy || (probingTotal >= 20 && probing.length >= 5)) {
    status = "crit";
    summary = locked.length ? `${locked.length} ta scope hozir qulflangan`
      : heavy ? "Bitta IP dan 30 dan ortiq xato urinish"
      : `${probing.length} ta mavjud bo'lmagan loginga ${probingTotal} urinish — parol tanlanyapti`;
    fix = "Notanish IP dan bo'lsa kirish darvozasini yoqing: /root/web-access.sh on " +
      "(yoki net <CIDR> bilan faqat o'z tarmog'ingizga cheklang).";
  } else if (stuck.length) {
    status = "warn";
    summary = `${stuck.map((r) => r.actor).join(", ")} — kira olmayapti (${stuck.reduce((a, r) => a + r.c, 0)} urinish, kirish yo'q)`;
    fix = "Bu hujum emas, xodim parolini eslay olmayapti. Panel → Xodimlar → parolni tiklang " +
      "va yangi parolni unga XAVFSIZ yo'l bilan bering (chatga tashlamang). " +
      "6 marta xato qilgan bo'lsa 15 daqiqa qulflanadi — hisoblagich muddatdan keyin ham qoladi, " +
      "ya'ni keyingi bitta xato darhol qayta qulflaydi.";
  } else if (armed.length || probingTotal >= 8) {
    status = "warn";
    summary = armed.length ? `${armed.length} ta scope qulf yoqasida`
      : `Mavjud bo'lmagan loginlarga ${probingTotal} urinish`;
    fix = "Kimniki ekanini jurnaldan ko'ring: Audit bo'limi yoki audit_events jadvali.";
  }
  return {
    status, summary, items, fix,
    meta: { f24, f7, ok24, locked: locked.length, stuck: stuck.length, probing: probing.length },
  };
}

// --- 6. Notanish tarmoqdan kirish ---
function chkNotanish({ db, gate, nets }) {
  const rows = db.prepare(
    "SELECT actor, entity ip, at FROM audit_events WHERE action='login.ok' " +
    "AND at >= datetime('now','-14 day') ORDER BY id DESC LIMIT 200",
  ).all();
  const unknown = rows.filter((r) => r.ip && !nets.some((c) => inCidr(r.ip, c)));
  const last24 = unknown.filter((r) => agoDays(r.at) < 1);
  const items = unknown.slice(0, 12).map((r) => ({
    label: `${r.actor} ← ${r.ip}`, value: r.at, bad: true,
  }));
  if (!unknown.length) items.push({ label: "Barcha kirishlar tanish tarmoqdan", value: `${rows.length} ta kirish (14 kun)`, bad: false });
  items.push({ label: "Tanish tarmoqlar", value: nets.join(", "), bad: false });

  let status = "ok";
  if (last24.length) status = "crit";
  else if (unknown.length) status = "warn";
  return {
    status,
    summary: last24.length
      ? `Oxirgi 24 soatda ${last24.length} ta notanish tarmoqdan kirish`
      : unknown.length ? `14 kunda ${unknown.length} ta notanish tarmoqdan kirish` : "Notanish tarmoqdan kirish yo'q",
    items,
    fix: gate.readable
      ? "Ro'yxat nginx konfigidan olinadi. Yangi ish tarmog'ini qo'shish: /root/web-access.sh net-add <CIDR>"
      : "nginx ro'yxati o'qilmadi — ro'yxat KNOWN_NETS muhit o'zgaruvchisidan olindi.",
    meta: { checked: rows.length, unknown: unknown.length, last24: last24.length },
  };
}

// --- 7. Tashqi skanerlar (nginx jurnali) ---
function chkSkan() {
  let text;
  try { text = tailFile(CFG.nginxLog); }
  catch (e) {
    return {
      status: "info",
      summary: "nginx jurnali o'qilmadi — skanerlar ko'rinmayapti",
      items: [{ label: "Sabab", value: e.code === "EACCES" ? "ruxsat yo'q (claude foydalanuvchisi adm guruhida emas)" : e.message, bad: true }],
      fix: "Bitta buyruq hal qiladi (root'dan): usermod -aG adm claude && systemctl restart sotuv-web\n" +
        "Shundan keyin qo'riqchi kim saytni skanerlayotganini ko'ra boshlaydi.",
      meta: { readable: false },
    };
  }
  const RX = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) ([^" ]*)[^"]*" (\d{3})/;
  const BAD = /(\.env|\.git|\.aws|\.ssh|wp-(login|admin|content)|phpmyadmin|xmlrpc|\/vendor\/|\/actuator|\/config\.json|\/\.well-known\/security|eval-stdin|\/shell|\/backup)/i;
  const hits = new Map();
  let lines = 0, probes = 0;
  const served = [];   // haqiqatan berilgan maxfiy fayllar
  for (const line of text.split("\n")) {
    const m = RX.exec(line);
    if (!m) continue;
    lines++;
    const [, ip, , , url, code] = m;
    // YO'L va SO'ROV PARAMETRINI ajratamiz. Skanerlar `/?file=../../.env` deb
    // so'raydi: yo'l `/`, ya'ni sayt oddiy sahifani 200 bilan qaytaradi va
    // parametr e'tiborsiz qoladi. Agar 200 ni "fayl berildi" deb o'qisak,
    // har kuni yolg'on signal chiqadi — bir marta shunga tushdim.
    const qi = url.indexOf("?");
    const path = qi < 0 ? url : url.slice(0, qi);
    if (!BAD.test(url)) continue;
    probes++;
    const e = hits.get(ip) || { n: 0, paths: new Set() };
    e.n++; e.paths.add(url.slice(0, 60));
    hits.set(ip, e);
    // Faqat YO'LNING o'zi maxfiy bo'lib, javob 2xx bo'lsa — fayl berilgan.
    if (BAD.test(path) && /^2/.test(code)) served.push({ ip, url: url.slice(0, 80), code });
  }
  const top = [...hits.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  const items = served.map((s) => ({ label: `BERILGAN: ${s.url}`, value: `${s.ip} · ${s.code}`, bad: true }));
  items.push({ label: "Qidiruv urinishi", value: `${probes} ta (${hits.size} IP)`, bad: false });
  items.push({ label: "Tekshirilgan jurnal qatori", value: String(lines), bad: false });
  for (const [ip, e] of top) items.push({ label: `IP ${ip}`, value: `${e.n} urinish · ${[...e.paths].slice(0, 2).join(" ")}`, bad: false });
  // Skaner urinishi har doim bo'ladi — bu internet, unga qarshi "chora" yo'q.
  // Muhimi bitta savol: biror maxfiy fayl HAQIQATAN berildimi.
  return {
    status: served.length ? "crit" : "ok",
    summary: served.length
      ? `${served.length} ta maxfiy fayl so'rovi 2xx javob oldi — TEKSHIRING`
      : probes
        ? `${probes} ta qidiruv urinishi (${hits.size} IP) — hammasi rad etilgan`
        : "Jurnalda skaner urinishi topilmadi",
    items,
    fix: served.length
      ? "Ro'yxatdagi manzilni o'zingiz oching va nima qaytarayotganini ko'ring. Haqiqatan fayl berilayotgan bo'lsa — o'sha joyni nginx'da yoping va ichidagi sirlarni almashtiring."
      : "Chora talab qilinmaydi: sayt bu so'rovlarga 404/403 qaytaradi. Skaner urinishining o'zi xavf emas.",
    meta: { readable: true, lines, probes, ips: hits.size, served: served.length },
  };
}

// --- 8. nginx kirish darvozasi ---
function chkDarvoza({ gate }) {
  if (!gate.readable) {
    return {
      status: "info", summary: "nginx konfigi o'qilmadi",
      items: [{ label: "Fayl", value: CFG.nginxAllow, bad: true }],
      fix: "Fayl yo'q yoki ruxsat yopiq — qo'lda tekshiring: /root/web-access.sh status",
      meta: {},
    };
  }
  const items = [
    { label: "Darvoza", value: gate.active ? "yoqilgan" : "O'CHIRILGAN", bad: !gate.active },
    { label: "Ruxsat etilgan tarmoqlar", value: gate.nets.join(", ") || "yo'q", bad: !gate.nets.length },
    { label: "Brauzer paroli (auth_basic)", value: gate.basic ? "bor" : "yo'q", bad: !gate.basic },
    { label: "Rejim", value: gate.satisfyAny ? "satisfy any (tanish tarmoq — parolsiz)" : "?", bad: false },
  ];
  const status = gate.active && gate.nets.length && gate.basic ? "ok" : "warn";
  return {
    status,
    summary: gate.active
      ? `Darvoza yoqilgan — ${gate.nets.length} ta tarmoq to'g'ridan-to'g'ri, qolganidan parol so'raladi`
      : "Darvoza o'chirilgan — panel butun internetga ochiq, yagona to'siq ilova paroli",
    items,
    fix: gate.active
      ? "Holat: /root/web-access.sh status · Tarmoq qo'shish: net-add <CIDR>"
      : "Darvozani ataylab o'chirgan bo'lsangiz — bu qator sariq turaveradi va shunday bo'lishi kerak: " +
        "panel butun internetdan ochiq, ya'ni parol yagona to'siq. Shu holatda 2FA majburiy bo'lishi shart. " +
        "Qaytarish: /root/web-access.sh on",
    meta: { active: gate.active, nets: gate.nets.length, basic: gate.basic },
  };
}

// --- 9. TLS sertifikati ---
function certInfo(host, port = 443) {
  return new Promise((resolve) => {
    const sock = tls.connect(
      { host: "127.0.0.1", port, servername: host, rejectUnauthorized: false, timeout: 6000 },
      () => {
        const c = sock.getPeerCertificate();
        const authorized = sock.authorized;
        const err = sock.authorizationError;
        sock.end();
        resolve(c && c.valid_to
          ? { ok: true, validTo: c.valid_to, validFrom: c.valid_from, authorized, err: err ? String(err) : null,
              issuer: (c.issuer && (c.issuer.O || c.issuer.CN)) || "?",
              subject: (c.subject && c.subject.CN) || "?", alt: c.subjectaltname || "" }
          : { ok: false, err: "sertifikat bo'sh" });
      },
    );
    sock.on("timeout", () => { sock.destroy(); resolve({ ok: false, err: "vaqt tugadi" }); });
    sock.on("error", (e) => resolve({ ok: false, err: e.message }));
  });
}

async function chkTls() {
  // Sertifikat fayllari root'niki (700) — shuning uchun fayldan emas,
  // TLS ulanishidan o'qiymiz. Ilova qaysi foydalanuvchi bo'lsa ham ishlaydi.
  const c = await certInfo(CFG.host);
  if (!c.ok) {
    return {
      status: "info", summary: "Sertifikat o'qilmadi",
      items: [{ label: "Sabab", value: c.err, bad: true }],
      fix: "Qo'lda: openssl s_client -connect 127.0.0.1:443 -servername " + CFG.host + " </dev/null | openssl x509 -noout -dates",
      meta: {},
    };
  }
  const left = days(new Date(c.validTo).getTime() - Date.now());
  const nameOk = new RegExp(CFG.host.replace(/\./g, "\\.")).test(c.alt + " " + c.subject);
  const items = [
    { label: "Muddat tugaydi", value: `${c.validTo} (${left} kun qoldi)`, bad: left < 21 },
    { label: "Bergan", value: c.issuer, bad: false },
    { label: "Domen", value: c.subject + (nameOk ? "" : " — domenga MOS EMAS"), bad: !nameOk },
    { label: "Zanjir tekshiruvi", value: c.authorized ? "to'g'ri" : `xato: ${c.err || "?"}`, bad: !c.authorized },
  ];
  let status = "ok";
  if (left < 7 || !nameOk || !c.authorized) status = "crit";
  else if (left < 21) status = "warn";
  return {
    status,
    summary: `Sertifikat ${left} kundan keyin tugaydi`,
    items,
    fix: left < 21 ? "certbot renew --dry-run bilan tekshiring; avtomatik yangilanish ishlamasa certbot renew" : "Avtomatik yangilanadi (certbot timer).",
    meta: { left, authorized: c.authorized },
  };
}

// --- 10. Xavfsizlik sarlavhalari ---
function appHeaders(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 6000 }, (res) => {
      res.resume();
      resolve({ ok: true, status: res.statusCode, headers: res.headers });
    });
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, err: "vaqt tugadi" }); });
    req.on("error", (e) => resolve({ ok: false, err: e.message }));
  });
}

async function chkSarlavha() {
  const r = await appHeaders(CFG.appPort);
  if (!r.ok) {
    return {
      status: "info", summary: "Ilova javob bermadi — sarlavhalar o'lchanmadi",
      items: [{ label: "Sabab", value: r.err, bad: true }], fix: "systemctl status sotuv-web", meta: {},
    };
  }
  const h = r.headers;
  const NEED = [
    ["content-security-policy", true, "sahifaga begona skript yuklanishini to'xtatadi"],
    ["x-frame-options", true, "saytni boshqa sahifa ichiga joylashtirishni taqiqlaydi"],
    ["x-content-type-options", false, "brauzer fayl turini o'zi taxmin qilmasin"],
    ["referrer-policy", false, "manzil begona saytga oqib chiqmasin"],
    ["permissions-policy", false, "kamera/mikrofon/joylashuvni yopadi"],
    ["cross-origin-opener-policy", false, "begona oyna bilan xotira ulashilmasin"],
  ];
  const items = NEED.map(([k, hard, why]) => ({
    label: k, value: h[k] ? "bor" : `YO'Q — ${why}`, bad: !h[k], hard,
  }));
  // HSTS uch joydan kelishi mumkin: ilova javobi, nginx konfigi (add_header) yoki Caddy konfigi (header blokida).
  const site = readText(CFG.nginxSite) || "";
  const hstsKonfig = /add_header\s+Strict-Transport-Security/i.test(site) || /Strict-Transport-Security/i.test(site);
  const hstsJavob = !!h["strict-transport-security"];
  const hsts = hstsJavob || hstsKonfig;
  items.push({
    label: `strict-transport-security (${hstsJavob ? "javob" : hstsKonfig ? "konfig" : "topilmadi"})`,
    value: hsts ? "bor" : "YO'Q", bad: !hsts, hard: true,
  });

  const csp = String(h["content-security-policy"] || "");
  for (const [d, label] of [["frame-ancestors 'none'", "freym taqiqi"], ["object-src 'none'", "plagin taqiqi"], ["base-uri", "base-uri cheklovi"]]) {
    items.push({ label: `CSP: ${label}`, value: csp.includes(d.split(" ")[0]) ? "bor" : "yo'q", bad: !csp.includes(d.split(" ")[0]), hard: false });
  }
  const missHard = items.filter((i) => i.bad && i.hard);
  const missSoft = items.filter((i) => i.bad && !i.hard);
  return {
    status: missHard.length ? "crit" : missSoft.length ? "warn" : "ok",
    summary: missHard.length
      ? `${missHard.length} ta asosiy sarlavha yo'q`
      : missSoft.length ? `${missSoft.length} ta qo'shimcha sarlavha yo'q` : "Barcha xavfsizlik sarlavhalari joyida",
    items,
    fix: "Sarlavhalar ikki joydan keladi: ilova (server.mjs) va nginx (nginx-sotuv-desk.conf). " +
      "Yo'qolgan bo'lsa — deploy serverdagi qo'lda qilingan o'zgarishni bosib ketgan bo'lishi mumkin, repodan tekshiring.",
    meta: { missHard: missHard.length, missSoft: missSoft.length },
  };
}

// --- 11. Tinglanayotgan portlar ---
function hexIp4(h) { return [6, 4, 2, 0].map((i) => parseInt(h.substr(i, 2), 16)).join("."); }
function hexIp6(h) {
  const bytes = [];
  for (let w = 0; w < 4; w++) {
    const word = h.substr(w * 8, 8);
    for (let b = 3; b >= 0; b--) bytes.push(word.substr(b * 2, 2));
  }
  const parts = [];
  for (let i = 0; i < 16; i += 2) parts.push((bytes[i] + bytes[i + 1]).replace(/^0+(?=.)/, ""));
  return parts.every((p) => p === "0") ? "::" : parts.join(":");
}

function listeners() {
  const out = [];
  for (const [f, v6] of [["/proc/net/tcp", false], ["/proc/net/tcp6", true]]) {
    const t = readText(f);
    if (t === null) continue;
    for (const line of t.split("\n").slice(1)) {
      const p = line.trim().split(/\s+/);
      if (p.length < 10 || p[3] !== "0A") continue;
      const [addr, portHex] = p[1].split(":");
      out.push({ ip: v6 ? hexIp6(addr) : hexIp4(addr), port: parseInt(portHex, 16), uid: Number(p[7]), v6 });
    }
  }
  return out;
}

function chkPort() {
  const all = listeners();
  if (!all.length) {
    return { status: "info", summary: "/proc/net/tcp o'qilmadi", items: [], fix: "Qo'lda: ss -ltnp", meta: {} };
  }
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) ham loopback — `ss` uni 0:0:0:0:0:FFFF:7F00:1
  // ko'rinishida chiqaradi va ilgari "internetdan ochiq" deb yolg'on ogohlantirardi (2026-10-27 audit).
  const loop = (ip) => { const s = String(ip).toUpperCase();
    return s.startsWith("127.") || s === "::1" || s === "0:0:0:0:0:0:0:1"
        || s.startsWith("::FFFF:127.") || s.startsWith("0:0:0:0:0:FFFF:7F00:1"); };
  const pub = all.filter((l) => !loop(l.ip));
  const EXPECTED = new Set([22, 80, 443, 8080, 8088]); // 8080 = Caddy HTTP (80-port sun-media band), 8088 = turniket webhook (Caddy)
  const seen = new Map();
  for (const l of pub) if (!seen.has(l.port)) seen.set(l.port, l);
  const unexpected = [...seen.values()].filter((l) => !EXPECTED.has(l.port));

  const items = [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([port, l]) => ({
    label: `${l.ip}:${port}`,
    value: EXPECTED.has(port) ? ({ 22: "SSH", 80: "HTTP (sun-media)", 443: "Caddy (HTTPS)", 8080: "Caddy (HTTP)", 8088: "Turniket webhook (Caddy)" })[port] : "KUTILMAGAN — internetdan ochiq",
    bad: !EXPECTED.has(port),
  }));
  // Ilovaning o'zi faqat ichkarida turishi kerak.
  const appPublic = pub.some((l) => l.port === CFG.appPort);
  items.push({
    label: `Ilova porti ${CFG.appPort}`,
    value: appPublic ? "TASHQARIGA OCHIQ — nginx chetlab o'tiladi" : "faqat 127.0.0.1 (to'g'ri)",
    bad: appPublic,
  });
  return {
    status: appPublic ? "crit" : unexpected.length ? "warn" : "ok",
    summary: appPublic
      ? `Ilova porti ${CFG.appPort} tashqariga ochiq`
      : unexpected.length ? `${unexpected.length} ta kutilmagan port internetdan ochiq` : "Faqat 22/80/443 ochiq",
    items,
    fix: "Kutilmagan port — nginx himoyasini chetlab o'tadi (rate-limit, parol, sarlavhalar ishlamaydi). " +
      "Kerak bo'lmasa xizmatni to'xtating yoki uni 127.0.0.1 ga bog'lang; kerak bo'lsa ufw bilan yoping.",
    meta: { public: seen.size, unexpected: unexpected.length, appPublic },
  };
}

// --- 12. Fayl huquqlari ---
function chkFayl() {
  // sev: sir yoki parol xeshi oshkor bo'ladigan joy — "crit"; qolgani "warn".
  // Papkaning o'zi keng bo'lsa-yu ichidagi fayllar yopiq bo'lsa, bu jiddiy emas.
  const targets = [
    { p: path.join(CFG.app, "data"), max: 0o700, what: "baza papkasi", sev: "crit" },
    { p: path.join(CFG.app, "data", "sotuv.db"), max: 0o600, what: "baza (parol xeshlari va sessiya tokenlari)", sev: "crit" },
    { p: path.join(CFG.app, "data", "sotuv.db-wal"), max: 0o600, what: "baza jurnali", sev: "crit", soft: true },
    { p: path.join(CFG.app, "data", "sotuv.db-shm"), max: 0o600, what: "baza xotirasi", sev: "crit", soft: true },
    { p: CFG.secrets, max: 0o700, what: "sirlar papkasi", sev: "crit" },
    { p: CFG.botEnv, max: 0o600, what: "Telegram bot tokeni", sev: "crit", soft: true },
    { p: CFG.backups, max: 0o750, what: "zaxira papkasi", sev: "warn", soft: true },
  ];
  const items = [];
  let crit = 0, warn = 0;
  for (const t of targets) {
    const s = statOf(t.p);
    if (!s) { if (!t.soft) { items.push({ label: t.p, value: "topilmadi", bad: true }); crit++; } continue; }
    const m = modeOf(s);
    const wide = (m & ~t.max) !== 0;
    if (wide) { if (t.sev === "crit") crit++; else warn++; }
    items.push({
      label: `${t.what}`,
      value: `${oct(m)}${wide ? ` — ${oct(t.max)} bo'lishi kerak` : ""}`,
      bad: wide, path: t.p,
    });
  }
  // Sirlar papkasidagi har bir .env alohida — bu doim jiddiy: ichida token turadi.
  try {
    for (const f of fs.readdirSync(CFG.secrets)) {
      if (!f.endsWith(".env")) continue;
      const m = modeOf(statOf(path.join(CFG.secrets, f)));
      if (m !== null && (m & 0o077) !== 0) { crit++; items.push({ label: `secrets/${f}`, value: `${oct(m)} — 600 bo'lishi kerak`, bad: true }); }
    }
  } catch {}
  const bad = crit + warn;
  return {
    status: crit ? "crit" : warn ? "warn" : "ok",
    summary: bad ? `${bad} ta fayl kerakdan keng ochiq` : "Baza, sirlar va zaxiralar yopiq",
    items,
    fix: "chmod 600 <fayl> / chmod 700 <papka>. Baza fayllarini ilova har ishga tushganda o'zi 600 qiladi — " +
      "shu yerda buzilgan ko'rinsa, ilova ishga tushmagan yoki fayl boshqa egaga o'tgan.",
    meta: { bad, crit, warn },
  };
}

// --- 13. Zaxira nusxa ---
function chkZaxira() {
  const dir = CFG.backups;
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".db"))
      .map((f) => ({ f, s: statOf(path.join(dir, f)) })).filter((x) => x.s)
      .sort((a, b) => b.s.mtimeMs - a.s.mtimeMs);
  } catch {
    return {
      status: "crit", summary: "Zaxira papkasi topilmadi",
      items: [{ label: "Papka", value: dir, bad: true }],
      fix: "Kunlik zaxira: /home/claude/scripts/infra/backup/sotuv-web-backup.sh — cron'da bor-yo'qligini tekshiring.",
      meta: { count: 0 },
    };
  }
  if (!files.length) {
    return {
      status: "crit", summary: "Bironta zaxira nusxa yo'q", items: [{ label: "Papka", value: dir, bad: true }],
      fix: "Qo'lda ishga tushiring: /home/claude/scripts/infra/backup/sotuv-web-backup.sh", meta: { count: 0 },
    };
  }
  const newest = files[0];
  const ageH = Math.floor((Date.now() - newest.s.mtimeMs) / 3600e3);
  const openMode = files.filter((x) => (modeOf(x.s) & 0o077) !== 0);
  const items = [
    { label: "Oxirgi nusxa", value: `${newest.f} · ${ageH} soat oldin · ${(newest.s.size / 1024).toFixed(0)} KB`, bad: ageH > 36 },
    { label: "Nusxalar soni", value: `${files.length} ta`, bad: files.length < 2 },
    { label: "Huquqlar", value: openMode.length ? `${openMode.length} ta nusxa ochiq (600 bo'lishi kerak)` : "hammasi 600", bad: !!openMode.length },
  ];
  return {
    status: ageH > 72 || openMode.length ? "crit" : ageH > 36 ? "warn" : "ok",
    summary: ageH > 36 ? `Oxirgi zaxira ${ageH} soat oldin` : `Zaxira yangi (${ageH} soat oldin), ${files.length} ta nusxa`,
    items,
    fix: "Kunlik cron: 03:20. Ishlamayotgan bo'lsa: crontab -u claude -l | grep backup",
    meta: { count: files.length, ageH },
  };
}

// --- 14. Audit jurnali ---
function chkJurnal({ db }) {
  const s = db.prepare("SELECT COUNT(*) c, MIN(at) first, MAX(at) last FROM audit_events").get();
  if (!s.c) {
    return { status: "crit", summary: "Audit jurnali bo'sh — hech qanday amal yozilmayapti", items: [], fix: "Ilova jurnalga yoza olmayotgan bo'lishi mumkin: journalctl -u sotuv-web -n 50", meta: {} };
  }
  const lastAgo = agoDays(s.last);
  const items = [
    { label: "Yozuvlar", value: `${s.c} ta`, bad: false },
    { label: "Davr", value: `${s.first} … ${s.last}`, bad: false },
    { label: "Oxirgi yozuv", value: `${lastAgo} kun oldin`, bad: lastAgo > 14 },
  ];
  return {
    status: lastAgo > 14 ? "warn" : "ok",
    summary: lastAgo > 14 ? `Jurnal ${lastAgo} kundan beri yangilanmagan` : `${s.c} ta yozuv, oxirgisi ${lastAgo} kun oldin`,
    items,
    fix: "Jurnal panelda: Audit bo'limi. Kirish urinishlari ham shu yerda yoziladi.",
    meta: { count: s.c, lastAgo },
  };
}

// --- 15. Brend fayllari butunligi ---
function chkBrend() {
  const man = readText(CFG.manifest);
  if (man === null) {
    return {
      status: "info", summary: "Butunlik manifesti yo'q", items: [{ label: "Fayl", value: CFG.manifest, bad: true }],
      fix: "Yaratish: /home/claude/scripts/infra/brand-guard.sh lock", meta: {},
    };
  }
  const items = [];
  let changed = 0, missing = 0, n = 0;
  for (const line of man.split("\n")) {
    const m = line.match(/^([0-9a-f]{64})\s+(.+)$/);
    if (!m) continue;
    n++;
    const [, sum, p] = m;
    let buf;
    try { buf = fs.readFileSync(p); }
    catch { missing++; items.push({ label: path.basename(p), value: "YO'QOLGAN", bad: true }); continue; }
    const now = createHash("sha256").update(buf).digest("hex");
    if (now !== sum) { changed++; items.push({ label: path.basename(p), value: "O'ZGARGAN", bad: true }); }
  }
  if (!changed && !missing) items.push({ label: "Barcha fayllar", value: `${n} ta — o'zgarmagan`, bad: false });
  return {
    status: changed || missing ? "crit" : "ok",
    summary: changed || missing ? `${changed} ta o'zgargan, ${missing} ta yo'qolgan brend fayli` : `${n} ta brend fayli o'zgarmagan`,
    items,
    fix: "Ataylab yangilagan bo'lsangiz: brand-guard.sh lock. Aks holda fayllar kim tomonidan almashtirilganini tekshiring.",
    meta: { n, changed, missing },
  };
}

// ================== RO'YXAT ==================
export const CHECKS = [
  // 2FA tekshiruvi 2026-09-12 da olib tashlandi — 2FA paneldan chiqarilgan (egasining qarori).
  { id: "hisob", group: "kirish", title: "Hisoblar holati", weight: 8, run: chkHisob },
  { id: "sessiya", group: "kirish", title: "Ochiq sessiyalar", weight: 6, run: chkSessiya },
  { id: "parol", group: "kirish", title: "Parol yoshi", weight: 6, run: chkParol },
  { id: "brut", group: "hujum", title: "Kirish urinishlari", weight: 14, run: chkBrut },
  { id: "notanish", group: "hujum", title: "Notanish tarmoqdan kirish", weight: 12, run: chkNotanish },
  { id: "skan", group: "hujum", title: "Tashqi skanerlar", weight: 6, run: chkSkan },
  { id: "darvoza", group: "server", title: "Kirish darvozasi", weight: 8, run: chkDarvoza },
  { id: "tls", group: "server", title: "TLS sertifikati", weight: 10, run: chkTls },
  { id: "sarlavha", group: "server", title: "Xavfsizlik sarlavhalari", weight: 8, run: chkSarlavha },
  { id: "port", group: "server", title: "Ochiq portlar", weight: 8, run: chkPort },
  { id: "fayl", group: "butunlik", title: "Fayl huquqlari", weight: 12, run: chkFayl },
  { id: "zaxira", group: "butunlik", title: "Zaxira nusxa", weight: 8, run: chkZaxira },
  { id: "jurnal", group: "butunlik", title: "Audit jurnali", weight: 4, run: chkJurnal },
  { id: "brend", group: "butunlik", title: "Brend fayllari butunligi", weight: 4, run: chkBrend },
];

// ================== HISOBOT ==================
export async function report(db, opts = {}) {
  const only = opts.only ? new Set([].concat(opts.only)) : null;
  const { nets, gate } = knownNets();
  const ctx = { db, gate, nets };

  const results = await Promise.all(CHECKS.filter((c) => !only || only.has(c.id)).map(async (c) => {
    try {
      const r = await c.run(ctx);
      return { id: c.id, group: c.group, title: c.title, weight: c.weight, ...r };
    } catch (e) {
      // Bitta tekshiruvning xatosi butun hisobotni yiqitmasin.
      return {
        id: c.id, group: c.group, title: c.title, weight: c.weight,
        status: "info", summary: "Tekshiruv bajarilmadi",
        items: [{ label: "Xato", value: String(e && e.message || e).slice(0, 200), bad: true }],
        fix: null, meta: {},
      };
    }
  }));

  const counts = { crit: 0, warn: 0, ok: 0, info: 0 };
  for (const r of results) counts[r.status]++;

  // Ball faqat O'LCHANGAN tekshiruvlar bo'yicha. "Ko'rmadim" ni "yaxshi" deb
  // hisoblash — o'zini aldash; shuning uchun info maxrajga ham kirmaydi,
  // uning o'rniga "o'lchanmadi: N" alohida ko'rsatiladi.
  const scored = results.filter((r) => r.status !== "info");
  const total = scored.reduce((a, r) => a + r.weight, 0) || 1;
  const penalty = scored.reduce((a, r) => a + r.weight * (r.status === "crit" ? 1 : r.status === "warn" ? 0.45 : 0), 0);
  const score = Math.max(0, Math.round(100 * (1 - penalty / total)));

  const level = counts.crit ? "xavf" : counts.warn ? "etibor" : "yaxshi";
  const headline = counts.crit
    ? `${counts.crit} ta jiddiy muammo` + (counts.warn ? `, ${counts.warn} ta ogohlantirish` : "")
    : counts.warn ? `${counts.warn} ta ogohlantirish` : "Jiddiy muammo topilmadi";

  return {
    at: new Date().toISOString(),
    host: CFG.host,
    score, level, headline, counts,
    unmeasured: counts.info,
    groups: GROUPS.map((g) => ({
      ...g,
      status: worst(results.filter((r) => r.group === g.id).map((r) => r.status)),
      checks: results.filter((r) => r.group === g.id),
    })),
    checks: results,
  };
}

// Telegram va CLI uchun qisqa matn.
export function textReport(rep, { full = false } = {}) {
  const ICON = { crit: "🔴", warn: "🟡", ok: "🟢", info: "⚪" };
  const L = [];
  L.push(`${ICON[rep.level === "xavf" ? "crit" : rep.level === "etibor" ? "warn" : "ok"]} Qo'riqchi — ${rep.host}`);
  L.push(`Ball: ${rep.score}/100 · ${rep.headline}` + (rep.unmeasured ? ` · o'lchanmadi: ${rep.unmeasured}` : ""));
  L.push("");
  for (const c of rep.checks) {
    if (!full && c.status === "ok") continue;
    L.push(`${ICON[c.status]} ${c.title}: ${c.summary}`);
    for (const it of (c.items || []).filter((i) => i.bad).slice(0, 4)) {
      L.push(`   · ${it.label}: ${it.value}`);
    }
    if (c.fix && c.status !== "ok") L.push(`   → ${String(c.fix).split("\n")[0]}`);
  }
  if (L[L.length - 1] !== "") L.push("");
  L.push(new Date(rep.at).toISOString().slice(0, 16).replace("T", " ") + " UTC");
  return L.join("\n");
}

// --- mustaqil ishga tushirish: node lib/qoriqchi.mjs [--full] [--json] ---
// Cron ham, qo'lda tekshirish ham shu yo'ldan boradi, ya'ni panel ko'rsatayotgan
// natija bilan terminal ko'rsatayotgan natija bir xil kodda hisoblanadi.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { DatabaseSync } = await import("node:sqlite");
  const dbPath = process.env.SOTUV_DB || path.join(APP, "data", "sotuv.db");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 8000;");
  const rep = await report(db);
  if (process.argv.includes("--json")) console.log(JSON.stringify(rep, null, 2));
  else console.log(textReport(rep, { full: process.argv.includes("--full") }));
  process.exit(rep.counts.crit ? 1 : 0);
}
