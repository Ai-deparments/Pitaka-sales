// Telegram «shaxsiy murabbiy» — operatorga o‘z qo‘ng‘iroqlari bo‘yicha ixcham karta (2026-09-30).
//
// G‘oya — egasi yuborgan 2-video (Metasell): operator har tahlil qilingan qo‘ng‘iroqdan keyin Telegram'da
// karta oladi — ball va o‘z o‘rtachasidan farq, gapirish balansi, savollar, kuchli/zaif mezon, 1–2 maslahat,
// keyingi qadam; kun oxirida — kun yakuni. Botga yozib ham so‘raydi: /oxirgi, /bugun, /mezon yoki mijoz ismi.
//
// Qoidalar (buzilmaydi):
//   • Rozilik: operator panelda «Ulash» bosib, bir martalik havola bilan O‘ZI ulanmaguncha unga hech narsa ketmaydi.
//   • Har kim faqat O‘Z qo‘ng‘iroqlarini oladi: qo‘ng‘iroq mas’uli (CRM ID) = panel hisobidagi CRM ID.
//   • Karta AI'siz, tayyor tahlildan yig‘iladi — Claude/Gemini sarflanmaydi.
//   • Bot tokeni faqat serverdagi fayldan (MURABBIY_TOKEN_FILE) — panelda ham, bazada ham saqlanmaydi.
//   • Qo‘ng‘iroq egasi tahlil paytida `coach_calls` ga yoziladi (callrun.mjs → qayd): karta va o‘rtacha
//     CRM'ga qayta murojaat qilmasdan hisoblanadi — adapter sovuq bo‘lsa ham bot javob beradi.
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { RUBRIC } from "./callai.mjs";
import * as RL from "./roles.mjs";
import * as menyu from "./menyu.mjs";   // tezkor raqamlar tugmalari (2026-10-29)
import * as ert from "./ertalab.mjs";    // ertalabki xabar: sotuvchiga o'z qadamsiz bitimlari (2026-10-29)

const TOKEN_FILE = process.env.MURABBIY_TOKEN_FILE || "/home/claude/secrets/murabbiy-bot.env";
const TG_API = (process.env.MURABBIY_TG_API || "https://api.telegram.org").replace(/\/+$/, "");
// Panel manzili faqat PANEL_URL dan (https). Bo'sh bo'lsa «Panelda ochish» tugmasi chiqmaydi (panelQator https talab qiladi).
const PANEL = String(process.env.PANEL_URL || "").replace(/\/+$/, "");
export const MIN_SEC = Number(process.env.MURABBIY_MIN_SEC || 60);   // bundan qisqa suhbatga karta ketmaydi (kun yakunida sanaladi)
const MAX_AGE_H = 24;          // eski qo‘ng‘iroq qayta tahlil qilinsa — karta yo‘q
const VAQT_STD = "18:30";      // kun yakuni (Toshkent); rahbar panelda o‘zgartiradi
const LEADER = ["ega", "ceo", "direktor", "rahbar", "admin"];

import { QISQA, MASLAHAT } from "./murabbiy-dars.mjs";
export { QISQA, MASLAHAT } from "./murabbiy-dars.mjs";
import * as V from "./murabbiy-vazifa.mjs";   // v2: qo'ng'iroqdan bitta vazifa, avto-tekshiruv (2026-11-01)
import * as D from "./murabbiy-dars.mjs";     // v2: kunlik mahorat, natija, mini-dars (2026-11-01)
import * as SO from "./murabbiy-sorov.mjs";    // v2: kechikkan lidlar sababi so'rovi (2026-11-02)
const OPERATOR_ROL = ["operator", "sotuvchi", "b2b", "menejer"];   // jamoa xulosasi (holat() dagi jamoa ro'yxati bilan bir xil)
const VZ_PREFIKS = "mv:";                                          // vazifa tugmalari (murabbiy-vazifa.tugmalar); menyu — "m:"

// ---------------------------------------------------------------- yordamchilar
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const kes = (s, n) => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const TZ = 5 * 3600e3;
const tkIso = (ms = Date.now()) => new Date(ms + TZ).toISOString();    // Toshkent devor soati («Z» shartli)
export const bugun = () => tkIso().slice(0, 10);
const OY = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const sanaUz = (s) => `${+s.slice(8, 10)}-${OY[+s.slice(5, 7) - 1]}`;
const soat = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? tkIso(t).slice(11, 16) : "—"; };
const kunOy = (iso) => { const t = Date.parse(iso || ""); if (!Number.isFinite(t)) return "—"; const s = tkIso(t); return `${s.slice(8, 10)}.${s.slice(5, 7)}`; };
const mmss = (s) => { s = Math.max(0, Math.round(+s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const soatDaq = (s) => { const m = Math.round((+s || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)} soat ${m % 60} daq` : `${m} daq`; };
const isoOf = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const kunChegara = (sana) => { const a = Date.parse(`${sana}T00:00:00+05:00`); return [new Date(a).toISOString(), new Date(a + 864e5).toISOString()]; };
// AI ba'zan bo'sh maydonga «null»/«yo'q» deb matn yozadi — bunday qiymat yo'q hisoblanadi
const bor = (v) => v != null && !/^(null|none|undefined|n\/a|yo.?q|—|-|\s*)$/i.test(String(v).trim());
const farqBelgi = (d) => (d >= 3 ? "📈" : d <= -3 ? "📉" : "≈");
const ishora = (d) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const daq = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const yakshanba = (ms) => new Date(ms + TZ).getUTCDay() === 0;                      // Toshkent bo'yicha
const ishdami = (ms) => { const h = new Date(ms + TZ).getUTCHours(); return !yakshanba(ms) && h >= V.ISH[0] && h < V.ISH[1]; };
const muddat = (iso) => V.muddatKunSoat(iso);

// ---------------------------------------------------------------- sxema
const _init = new WeakSet();
export function init(db) {
  if (_init.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS coach_calls (
      call_id  TEXT PRIMARY KEY,
      owner    TEXT NOT NULL,              -- CRM mas'ul (RESPONSIBLE_ID) — kimning qo'ng'irog'i
      at       TEXT,                       -- ISO UTC
      dur      INTEGER, out INTEGER,
      title    TEXT, kind TEXT, eid TEXT,  -- CRM yozuvi (lid/bitim) nomi va ID si
      cname    TEXT,                       -- mijoz ismi (tahlildan) — botda ism bo'yicha qidirish uchun
      score    INTEGER, talk INTEGER,      -- ball /100, operator gapirgan %
      crit     TEXT,                       -- {mezon: 0..1}
      next     INTEGER,                    -- keyingi qadam belgilanganmi
      added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      card_at  TEXT, card_chat TEXT, card_err TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cc_owner ON coach_calls(owner, at);
    CREATE INDEX IF NOT EXISTS idx_cc_card  ON coach_calls(card_at, at);
    CREATE TABLE IF NOT EXISTS coach_links (
      user_id   INTEGER PRIMARY KEY,
      chat_id   TEXT NOT NULL UNIQUE,
      tg_name   TEXT,
      mode      TEXT NOT NULL DEFAULT 'har',   -- har: har qo'ng'iroq + kun yakuni | kun: faqat kun yakuni
      paused    INTEGER NOT NULL DEFAULT 0,    -- 1: operator to'xtatgan, 2: botni bloklagan
      linked_at TEXT NOT NULL,
      last_at   TEXT
    );
    CREATE TABLE IF NOT EXISTS coach_tokens (
      token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL,
      by_user INTEGER, used_at TEXT
    );
    CREATE TABLE IF NOT EXISTS coach_digest (
      user_id INTEGER NOT NULL, day TEXT NOT NULL, sent_at TEXT, note TEXT,
      PRIMARY KEY (user_id, day)
    );
    CREATE TABLE IF NOT EXISTS coach_meta (k TEXT PRIMARY KEY, v TEXT);
  `);
  V.init(db);                                // coach_tasks (+ panel tasks doskasi)
  D.init(db);                                // coach_focus
  SO.init(db);                               // coach_sorov, coach_sorov_q
  _init.add(db);
}
const meta = (db, k) => db.prepare("SELECT v FROM coach_meta WHERE k=?").get(k)?.v ?? null;
const setMeta = (db, k, v) => db.prepare("INSERT INTO coach_meta (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(k, v == null ? null : String(v));
const delMeta = (db, k) => db.prepare("DELETE FROM coach_meta WHERE k=?").run(k);

// Sozlama (rahbar): murabbiy_faol on/off, murabbiy_vaqt HH:MM; v2 — murabbiy_vazifa, murabbiy_mahorat on/off (standart on)
export function sozlama(db) {
  const g = (k) => { try { return db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value ?? null; } catch { return null; } };
  const vaqt = g("murabbiy_vaqt");
  return { faol: g("murabbiy_faol") !== "off", vaqt: /^([01]\d|2[0-3]):[0-5]\d$/.test(vaqt || "") ? vaqt : VAQT_STD,
    vazifa: g("murabbiy_vazifa") !== "off", mahorat: g("murabbiy_mahorat") !== "off" };
}
export function sozla(db, { faol, vaqt, vazifa, mahorat } = {}, userId = null) {
  const put = (k, v) => db.prepare(`INSERT INTO settings (key,value,updated_by) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now'), updated_by=excluded.updated_by`).run(k, v, userId);
  if (faol !== undefined) put("murabbiy_faol", faol ? "on" : "off");
  if (vazifa !== undefined) put("murabbiy_vazifa", vazifa ? "on" : "off");
  if (mahorat !== undefined) put("murabbiy_mahorat", mahorat ? "on" : "off");
  if (vaqt !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(vaqt))) throw Object.assign(new Error("Vaqt HH:MM ko‘rinishida bo‘lsin"), { status: 400 });
    put("murabbiy_vaqt", String(vaqt));
  }
  return sozlama(db);
}

// Bot tokeni: muhit o'zgaruvchisi yoki server fayli (daqiqasiga bir marta qayta o'qiladi — egasi
// tokenni saqlagach xizmatni qayta ishga tushirish shart emas).
let _tok = { v: null, at: 0 };
export function token() {
  const env = String(process.env.MURABBIY_BOT_TOKEN || "").trim();
  if (env) return env;
  if (Date.now() - _tok.at < 60e3) return _tok.v;
  let v = null;
  try {
    const m = fs.readFileSync(TOKEN_FILE, "utf8").match(/^\s*MURABBIY_BOT_TOKEN\s*=\s*["']?(\d{5,}:[\w-]{20,})["']?\s*$/m);
    v = m ? m[1] : null;
  } catch {}
  _tok = { v, at: Date.now() };
  return v;
}

// ---------------------------------------------------------------- qo'ng'iroqni qayd qilish (tahlil paytida)
// callrun.runAnalysis har saqlashdan keyin chaqiradi (web va cron ishchisi — ikkalasida ham).
// Qayta tahlil (Gemini bilan yangilash) ball va mezonlarni yangilaydi, karta esa bir marta ketadi.
export function qayd(db, callId, a, call) {
  if (!call || !call.owner || call.owner === "?" || !a) return;
  init(db);
  const crit = {};
  for (const c of a.operator_score?.criteria || []) if (c && c.id && c.max > 0) crit[c.id] = +Math.max(0, Math.min(1, c.score / c.max)).toFixed(3);
  const cname = a.customer?.name && !/noma.?lum|unknown/i.test(a.customer.name) ? kes(a.customer.name, 60) : null;
  db.prepare(`INSERT INTO coach_calls (call_id, owner, at, dur, out, title, kind, eid, cname, score, talk, crit, next)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(call_id) DO UPDATE SET owner=excluded.owner, at=COALESCE(excluded.at, coach_calls.at),
        dur=excluded.dur, out=excluded.out, title=COALESCE(excluded.title, coach_calls.title),
        kind=COALESCE(excluded.kind, coach_calls.kind), eid=COALESCE(excluded.eid, coach_calls.eid),
        cname=COALESCE(excluded.cname, coach_calls.cname), score=excluded.score, talk=excluded.talk,
        crit=excluded.crit, next=excluded.next`)
    .run(String(callId), String(call.owner), isoOf(call.at), Math.round(call.dur || 0), call.out ? 1 : 0,
      call.entity?.title ? kes(call.entity.title, 120) : null, call.entity?.kind || null,
      call.entity?.id ? String(call.entity.id) : null, cname,
      a.operator_score?.total ?? null, a.stats?.talkShare?.operator ?? null, JSON.stringify(crit),
      bor(a.next_action?.text) ? 1 : 0);
}

// ---------------------------------------------------------------- karta (bitta qo'ng'iroq)
function ortacha(db, owner, exceptId, days = 30) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  return db.prepare(`SELECT COUNT(*) n, AVG(score) s FROM coach_calls
    WHERE owner=? AND at>=? AND call_id<>? AND score IS NOT NULL`).get(String(owner), since, String(exceptId));   // v2: panel ta'rifi
}
const entLabel = (c) => (c.eid ? `${c.kind === "deal" ? "Bitim" : c.kind === "contact" ? "Kontakt" : c.kind === "company" ? "Kompaniya" : "Lid"} #${c.eid}` : "");

// Telegram HTML (b, i, pre) — har o'zgaruvchan matn esc() dan o'tadi; panel ham shu matnni ko'rsatadi.
export function karta(db, callId) {
  init(db);
  const c = db.prepare("SELECT * FROM coach_calls WHERE call_id=?").get(String(callId));
  const row = db.prepare("SELECT json FROM call_analyses WHERE call_id=? AND status='ready'").get(String(callId));
  if (!c || !row) return null;
  let a; try { a = JSON.parse(row.json); } catch { return null; }
  const L = [];
  const nom = c.title || c.cname || "Mijoz";
  L.push("🎧 <b>Qo‘ng‘iroq tahlili</b>");
  L.push(`<b>${esc(kes(nom, 60))}</b>${c.eid ? ` · ${esc(entLabel(c))}` : ""}`);
  L.push(`${kunOy(c.at)} · ${soat(c.at)} · ${mmss(c.dur)} · ${c.out ? "chiquvchi" : "kiruvchi"}`);
  L.push("");
  const sc = a.operator_score?.total ?? c.score;
  const av = ortacha(db, c.owner, c.call_id);
  if (sc != null) {
    let s = `⭐ Ball: <b>${sc}</b>/100`;
    if (av && av.n >= 5 && av.s != null) { const d = Math.round(sc - av.s); s += ` · o‘rtachangiz ${Math.round(av.s)} → <b>${ishora(d)}</b> ${farqBelgi(d)}`; }
    L.push(s);
  }
  const ts = a.stats?.talkShare, cn = a.stats?.counts || {};
  if (ts && Number.isFinite(ts.operator)) L.push(`🗣 Gapirish: siz <b>${ts.operator}%</b> · mijoz ${ts.customer}%${ts.operator > 60 ? " — ko‘proq tinglang" : ""}`);
  if (Number.isFinite(cn.questions)) L.push(`❓ Savollar: ${cn.questions} (ochiq ${cn.openQuestions ?? 0})${a.stats?.measured?.interrupts ? ` · ✋ gap bo‘lish: ${cn.interrupts ?? 0}` : ""}`);

  const cr = (a.operator_score?.criteria || []).filter((x) => x && x.id && x.max > 0).map((x) => ({ ...x, p: x.score / x.max }));
  const best = [...cr].sort((x, y) => y.p - x.p || y.max - x.max)[0];
  const worst = [...cr].sort((x, y) => x.p - y.p || y.max - x.max)[0];
  if (best || worst) L.push("");
  if (best && best.p >= 0.7) L.push(`✅ Kuchli: ${esc(QISQA[best.id] || best.label)} — ${best.score}/${best.max}`);
  if (worst && worst.p < 0.6 && worst !== best) L.push(`⚠️ O‘sish: ${esc(QISQA[worst.id] || worst.label)} — ${worst.score}/${worst.max}`);

  // Maslahat: 1) javobsiz/zaif e'tiroz — «nima deyish kerak edi»; 2) eng zaif mezon bo'yicha
  const tips = [];
  const ob = (a.objections || []).find((o) => o && o.tip && (o.answered === false || o.answerQuality === "weak" || o.answerQuality === "none"));
  if (ob && bor(ob.text) && bor(ob.tip)) tips.push(`💬 E’tiroz «${esc(kes(ob.text, 70))}» → ${esc(kes(ob.tip, 170))}`);
  if (worst && worst.p < 0.6) tips.push(`💡 ${esc(kes(bor(worst.tip) ? worst.tip : MASLAHAT[worst.id] || "", 190))}`);
  else if (!ob && sc != null && sc >= 75) tips.push("💡 Zo‘r suhbat — shu uslubni saqlang.");
  if (tips.length) { L.push(""); L.push(...tips.slice(0, 2)); }

  L.push("");
  const nx = a.next_action;
  if (nx && bor(nx.text)) L.push(`➡️ Keyingi qadam: ${esc(kes(nx.text, 140))}${bor(nx.due) ? ` (${esc(kes(nx.due, 40))})` : ""}`);
  else L.push("⚠️ Keyingi qadam belgilanmagan — CRM’ga sana bilan yozing.");
  return { html: L.join("\n"), callId: c.call_id, url: PANEL ? `${PANEL}/?call=${encodeURIComponent(c.call_id)}` : null, at: c.at, owner: c.owner };
}

// ---------------------------------------------------------------- kun yakuni
// stat: {total, missed, answered, talk (s)} — CRM'dagi shu kungi qo'ng'iroqlar (kunStat dan)
// userId berilsa (v2): oxirida ertalabki fokus natijasi va shu kungi vazifalar qatori
export function kunYakuni(db, owner, sana, stat = null, { userId } = {}) {
  init(db);
  const [dan, gacha] = kunChegara(sana);
  const rows = db.prepare(`SELECT * FROM coach_calls WHERE owner=? AND at>=? AND at<? AND score IS NOT NULL`).all(String(owner), dan, gacha);
  if (!rows.length && !(stat && stat.total)) return null;
  const L = [`📊 <b>Kun yakuni</b> · ${sanaUz(sana)}`];
  if (stat && stat.total) {
    L.push(`📞 Qo‘ng‘iroq: <b>${stat.total}</b> · bog‘landi <b>${stat.answered}</b> (${Math.round(stat.answered / stat.total * 100)}%) · javobsiz ${stat.missed}`);
    if (stat.talk) L.push(`⏱ Suhbat: <b>${soatDaq(stat.talk)}</b>${stat.answered ? ` · o‘rtacha ${mmss(stat.talk / stat.answered)}` : ""}`);
  }
  const an = rows.filter((r) => (r.dur || 0) >= MIN_SEC);
  if (an.length) {
    const avg = Math.round(an.reduce((s, r) => s + r.score, 0) / an.length);
    const since = new Date(Date.parse(dan) - 30 * 864e5).toISOString();
    const o30 = db.prepare(`SELECT COUNT(*) n, AVG(score) s FROM coach_calls WHERE owner=? AND at>=? AND at<? AND score IS NOT NULL`)
      .get(String(owner), since, dan);   // v2: panel ta'rifi
    let s = `⭐ O‘rtacha ball: <b>${avg}</b> (${an.length} ta tahlil)`;
    if (o30 && o30.n >= 5) { const d = Math.round(avg - o30.s); s += ` · 30 kun: ${Math.round(o30.s)} → <b>${ishora(d)}</b> ${farqBelgi(d)}`; }
    L.push(s);
    const top = [...an].sort((x, y) => y.score - x.score)[0];
    if (top) L.push(`🏆 Eng yaxshisi: ${esc(kes(top.title || top.cname || "mijoz", 40))} — <b>${top.score}</b>`);
    const nextYoq = an.filter((r) => !r.next).length;
    if (nextYoq) L.push(`⚠️ Keyingi qadamsiz: ${nextYoq} / ${an.length} qo‘ng‘iroq`);
    // Ertangi fokus: bugun eng past mezon (vazni katta bo'lsa — birinchi)
    const S = {}, N = {};
    for (const r of an) { let c = {}; try { c = JSON.parse(r.crit || "{}"); } catch {} for (const [k, v] of Object.entries(c)) { S[k] = (S[k] || 0) + v; N[k] = (N[k] || 0) + 1; } }
    const w = RUBRIC.map((x) => ({ ...x, p: N[x.id] ? S[x.id] / N[x.id] : null })).filter((x) => x.p != null)
      .sort((x, y) => x.p - y.p || y.max - x.max)[0];
    if (w && w.p < 0.7) {
      L.push("");
      L.push(`🎯 <b>Ertangi fokus:</b> ${esc(QISQA[w.id] || w.label)} — bugun o‘rtacha ${Math.round(w.p * 100)}%`);
      L.push(`💡 ${esc(MASLAHAT[w.id] || "")}`);
    }
  } else if (stat && stat.answered) {
    L.push("🕐 Bugungi suhbatlar hali tahlil qilinmoqda — natijani /oxirgi bilan ko‘ring.");
  }
  if (userId != null) {
    const qosh = [];
    const nt = D.natija(db, userId, owner, sana);
    if (nt) qosh.push(nt);
    const v = V.kunStat(db, userId, sana);
    if (v.berildi > 0) qosh.push(`📌 Vazifalar: berildi ${v.berildi} · bajarildi ${v.bajarildi} · ochiq ${v.ochiq}${v.kechikdi ? ` · kechikkan ${v.kechikdi}` : ""}`);
    if (qosh.length) L.push("", ...qosh);
  }
  return { html: L.join("\n") };
}

// ---------------------------------------------------------------- jamoa xulosasi (rahbarga, kechqurun va /jamoa)
// Har botga ulangan operator: bugungi tahlil qilingan suhbat (≥ MIN_SEC), o'rtacha ball, vazifa bajarildi/berildi, kechikkan;
// ulanmaganlar soni va bugungi kritik suhbatlar. Bugun hech qanday faoliyat bo'lmasa — null (yakshanba shovqin bo'lmasin).
const sqlVaqt = (isoStr) => isoStr.slice(0, 19).replace("T", " ");    // call_analyses.analyzed_at — datetime('now') ko'rinishi
export function jamoa(db, sana) {
  init(db);
  const [dan, gacha] = kunChegara(sana);
  const ops = db.prepare(`SELECT u.id, u.name, TRIM(u.bitrix_user_id) owner, l.user_id linked FROM users u
      LEFT JOIN coach_links l ON l.user_id=u.id
    WHERE u.bitrix_user_id IS NOT NULL AND TRIM(u.bitrix_user_id)<>'' AND u.role IN (${OPERATOR_ROL.map(() => "?").join(",")})
    ORDER BY u.name`).all(...OPERATOR_ROL);
  const kun = db.prepare(`SELECT COUNT(*) n, AVG(score) s FROM coach_calls WHERE owner=? AND at>=? AND at<? AND score IS NOT NULL AND dur>=?`);
  const qatorlar = ops.filter((o) => o.linked != null)
    .map((o) => ({ ...o, ...kun.get(o.owner, dan, gacha, MIN_SEC), v: V.kunStat(db, o.id, sana) }))
    .sort((x, y) => y.n - x.n || String(x.name || "").localeCompare(String(y.name || "")));
  const ulanmagan = ops.length - qatorlar.length;
  const jami = db.prepare(`SELECT COUNT(*) n, AVG(score) s FROM coach_calls WHERE at>=? AND at<? AND score IS NOT NULL AND dur>=?`).get(dan, gacha, MIN_SEC);
  // Kritik: tahlildagi urgency.level (ustun yoki JSON); kun — qo'ng'iroq vaqti, u noma'lum bo'lsa (egasi yozilmagan) tahlil vaqti
  const kritik = db.prepare(`SELECT COUNT(*) n FROM call_analyses a LEFT JOIN coach_calls c ON c.call_id=a.call_id
    WHERE a.status='ready'
      AND COALESCE(a.urgency, CASE WHEN json_valid(a.json) THEN json_extract(a.json, '$.urgency.level') END)='critical'
      AND ((c.at IS NOT NULL AND c.at>=? AND c.at<?) OR (c.at IS NULL AND a.analyzed_at>=? AND a.analyzed_at<?))`)
    .get(dan, gacha, sqlVaqt(dan), sqlVaqt(gacha)).n;
  const berildi = qatorlar.reduce((s, o) => s + o.v.berildi, 0);
  if (!jami.n && !kritik && !berildi) return null;
  const L = [`👥 <b>Jamoa xulosasi</b> · ${sanaUz(sana)}`];
  if (jami.n) L.push(`📞 Tahlil qilingan suhbat: <b>${jami.n}</b> · o‘rtacha ball <b>${Math.round(jami.s)}</b>`);
  L.push("");
  if (qatorlar.length) {
    for (const o of qatorlar) L.push(`• ${esc(kes(o.name || "—", 40))} — ${o.n} suhbat · ${o.n ? `<b>${Math.round(o.s)}</b>` : "—"} ball · vazifa ${o.v.bajarildi}/${o.v.berildi} · kechikkan ${o.v.kechikdi}`);
  } else L.push("Botga ulangan operator yo‘q.");
  L.push("");
  L.push(`🔌 Botga ulanmagan: ${ulanmagan} operator`);
  L.push(`🚨 Kritik suhbatlar bugun: ${kritik}`);
  return L.join("\n");
}

// ---------------------------------------------------------------- 30 kunlik mezonlar (/mezon)
export function mezon(db, owner, days = 30) {
  init(db);
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const all = db.prepare("SELECT owner, crit FROM coach_calls WHERE at>=? AND crit IS NOT NULL AND crit<>'{}'").all(since);
  const agg = (rows) => { const S = {}, N = {};
    for (const r of rows) { let c = {}; try { c = JSON.parse(r.crit); } catch {} for (const [k, v] of Object.entries(c)) { S[k] = (S[k] || 0) + v; N[k] = (N[k] || 0) + 1; } }
    return Object.fromEntries(Object.keys(S).map((k) => [k, Math.round(S[k] / N[k] * 100)])); };
  const mine = all.filter((r) => r.owner === String(owner));
  if (!mine.length) return null;
  const op = agg(mine), team = agg(all);
  const rows = RUBRIC.map((c) => ({ id: c.id, op: op[c.id], team: team[c.id] })).filter((r) => r.op != null);
  const bar = (p) => "█".repeat(Math.round(p / 10)) + "░".repeat(10 - Math.round(p / 10));
  const L = [`📐 <b>Mezonlaringiz — ${days} kun</b> (${mine.length} ta tahlil)`, "<pre>"];
  for (const r of rows) {
    const d = r.team != null ? r.op - r.team : 0;
    L.push(`${(QISQA[r.id] || r.id).padEnd(13)} ${bar(r.op)} ${String(r.op).padStart(3)} ${d > 0 ? "▲" + d : d < 0 ? "▼" + -d : " ="}`);
  }
  L.push("</pre>");
  L.push("<i>▲▼ — jamoa o‘rtachasidan farq (foiz punkt)</i>");
  const withD = rows.filter((r) => r.team != null).map((r) => ({ ...r, d: r.op - r.team }));
  const kuchli = withD.filter((r) => r.d >= 5).sort((x, y) => y.d - x.d).slice(0, 2);
  const osish = withD.filter((r) => r.d <= -5).sort((x, y) => x.d - y.d).slice(0, 2);
  if (kuchli.length) L.push(`💪 Kuchli: ${kuchli.map((r) => `${esc(QISQA[r.id])} (${ishora(r.d)})`).join(", ")}`);
  if (osish.length) L.push(`🎯 O‘sish kerak: ${osish.map((r) => `${esc(QISQA[r.id])} (${ishora(r.d)})`).join(", ")}`);
  const past = [...rows].sort((x, y) => x.op - y.op)[0];
  if (past && past.op < 60) L.push(`💡 ${esc(MASLAHAT[past.id] || "")}`);
  return { html: L.join("\n") };
}

// ---------------------------------------------------------------- ism bo'yicha qidirish (Metasell: «Rizoiddin bilan suhbatim»)
const KIR = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i",
  ь: "", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h" };
export const norm = (s) => String(s || "").toLowerCase().replace(/[а-яёўқғҳ]/g, (c) => KIR[c] ?? c)
  .replace(/[‘’ʻʼ'`´]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["bilan", "suhbat", "suhbatim", "suhbatni", "suhbatimni", "qongiroq", "qongirogim", "qongiroqni", "mijoz",
  "aka", "opa", "haqida", "korsat", "korsating", "tahlil", "tahlili", "karta", "kartasi", "menga", "kerak", "iltimos", "oxirgi"]);
export function qidir(db, owner, text, days = 30) {
  init(db);
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const rows = db.prepare(`SELECT call_id, at, dur, title, cname, eid, score FROM coach_calls
    WHERE owner=? AND at>=? AND score IS NOT NULL ORDER BY at DESC LIMIT 800`).all(String(owner), since);
  const q = norm(text);
  const nums = q.match(/\b\d{3,}\b/g) || [];
  const words = q.split(" ").filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
  if (!nums.length && !words.length) return [];
  const hay = (r) => ` ${norm(r.title)} ${norm(r.cname)} `;
  let hit = rows.filter((r) => nums.some((n) => r.eid === n || String(r.call_id).replace(/\D/g, "") === n));
  if (!hit.length && words.length) {
    hit = rows.filter((r) => words.every((w) => hay(r).includes(w)));
    if (!hit.length) hit = rows.filter((r) => words.some((w) => hay(r).includes(w)));
  }
  return hit.slice(0, 5);
}

// ---------------------------------------------------------------- ulash (bir martalik havola)
export function botNomi(db) { init(db); return meta(db, "bot"); }
export function havola(db, userId, byUser = null) {
  init(db);
  const bot = meta(db, "bot");
  if (!token() || !bot) throw Object.assign(new Error("Murabbiy boti hali sozlanmagan"), { status: 409 });
  const tok = randomBytes(18).toString("base64url");                 // 24 belgi — Telegram start parametri
  const ttl = byUser && byUser !== userId ? 24 * 3600e3 : 30 * 60e3;   // rahbar yaratgan havola — 1 kun
  db.prepare("DELETE FROM coach_tokens WHERE expires < ? OR (user_id=? AND used_at IS NULL AND by_user IS ?)").run(Date.now() - 864e5, userId, byUser);
  db.prepare("INSERT INTO coach_tokens (token,user_id,expires,by_user) VALUES (?,?,?,?)").run(tok, userId, Date.now() + ttl, byUser);
  return { url: `https://t.me/${bot}?start=${tok}`, expires: new Date(Date.now() + ttl).toISOString(), bot };
}
// Boshqa odam uchun havola: rahbar — jamoa a'zosiga. Rahbar/admin hisobiga havolani faqat egasining o'zi yoki ega/CEO yaratadi:
// tugmalar menyusi (2026-10-29) shu hisobga bo'lim raqamlarini ochadi, havola esa birinchi ochgan odamga ishlaydi.
export function havolaMumkin(by, target) {
  if (!by || !target) return false;
  if (Number(by.id) === Number(target.id)) return true;
  if (!LEADER.includes(by.role)) return false;
  return !RL.FULL_VIEW.includes(target.role) || RL.SUPERADMIN.includes(by.role);
}
export function uzish(db, userId) {
  init(db);
  return db.prepare("DELETE FROM coach_links WHERE user_id=?").run(userId).changes > 0;
}
export function rejim(db, userId, { mode, paused } = {}) {
  init(db);
  const l = db.prepare("SELECT * FROM coach_links WHERE user_id=?").get(userId);
  if (!l) throw Object.assign(new Error("Telegram ulanmagan"), { status: 409 });
  if (mode !== undefined) {
    if (!["har", "kun"].includes(mode)) throw Object.assign(new Error("Rejim: har yoki kun"), { status: 400 });
    db.prepare("UPDATE coach_links SET mode=? WHERE user_id=?").run(mode, userId);
  }
  if (paused !== undefined) db.prepare("UPDATE coach_links SET paused=? WHERE user_id=?").run(paused ? 1 : 0, userId);
  return holatUser(db, userId);
}
function holatUser(db, userId) {
  const l = db.prepare("SELECT * FROM coach_links WHERE user_id=?").get(userId);
  if (!l) return { ulangan: false };
  return { ulangan: true, tgName: l.tg_name, mode: l.mode, paused: l.paused === 1, bloklangan: l.paused === 2, since: l.linked_at, oxirgi: l.last_at };
}

// Panel uchun holat. Rahbar — jamoa ro'yxati va bot holati ham.
export function holat(db, user) {
  init(db);
  const S = sozlama(db);
  const out = { sozlangan: !!token(), bot: meta(db, "bot"), faol: S.faol, vaqt: S.vaqt, vazifa: S.vazifa, mahorat: S.mahorat, minSec: MIN_SEC,
    crm: !!user.bitrixUserId, men: holatUser(db, user.id) };
  if (LEADER.includes(user.role)) {
    const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
    out.tizim = { pollAt: meta(db, "poll_at"), xato: meta(db, "xato"), xatoAt: meta(db, "xato_at"), backfill: meta(db, "backfill") };
    out.jamoa = db.prepare(`SELECT u.id, u.name, u.role, u.bitrix_user_id owner, l.tg_name, l.mode, l.paused, l.linked_at, l.last_at,
        (SELECT COUNT(*) FROM coach_calls c WHERE c.card_chat=l.chat_id AND c.card_at>=? AND c.card_err IS NULL) kartalar,
        (SELECT COUNT(*) FROM coach_calls c WHERE c.owner=u.bitrix_user_id AND c.at>=? AND c.score IS NOT NULL) tahlil
      FROM users u LEFT JOIN coach_links l ON l.user_id=u.id
      WHERE u.bitrix_user_id IS NOT NULL AND u.bitrix_user_id<>'' AND u.role IN ('operator','sotuvchi','b2b','menejer')
      ORDER BY (l.user_id IS NULL), u.name`).all(since7, since7)
      .map((r) => ({ id: r.id, name: r.name, role: r.role, owner: r.owner, ulangan: !!r.linked_at, tgName: r.tg_name, mode: r.mode,
        paused: r.paused === 1, bloklangan: r.paused === 2, since: r.linked_at, oxirgi: r.last_at, kartalar: r.kartalar, tahlil: r.tahlil }));
  }
  return out;
}

// Panel namunasi: shu egasining eng oxirgi (MIN_SEC dan uzun) tahlil qilingan qo'ng'irog'i kartasi
export function namuna(db, owner) {
  init(db);
  const q = owner
    ? db.prepare("SELECT call_id FROM coach_calls WHERE owner=? AND score IS NOT NULL AND dur>=? ORDER BY at DESC LIMIT 1").get(String(owner), MIN_SEC)
    : db.prepare("SELECT call_id FROM coach_calls WHERE score IS NOT NULL AND dur>=? ORDER BY at DESC LIMIT 1").get(MIN_SEC);
  return q ? karta(db, q.call_id) : null;
}

// ---------------------------------------------------------------- Telegram
async function tg(method, body, ms = 15000) {
  const tok = token();
  if (!tok) throw Object.assign(new Error("token yo‘q"), { code: 0 });
  let r;
  try {
    r = await fetch(`${TG_API}/bot${tok}/${method}`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}), signal: AbortSignal.timeout(ms) });
  } catch (e) { throw Object.assign(new Error(`tarmoq: ${e.message}`), { code: -1 }); }
  const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}`, error_code: r.status }));
  if (!j.ok) throw Object.assign(new Error(j.description || "Telegram xatosi"), { code: j.error_code, retry: j.parameters?.retry_after });
  return j.result;
}
const panelQator = (url) => (url && /^https:\/\//.test(url) ? [{ text: "📊 Panelda ochish", url }] : null);   // Telegram faqat https qabul qiladi
const plain = (h) => String(h).replace(/<\/?(b|i|pre|code)>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
async function yubor(chat, m) {
  const body = { chat_id: chat, text: m.html, parse_mode: "HTML", link_preview_options: { is_disabled: true } };
  // Telegram faqat https havolali tugmani qabul qiladi
  if (m.kb) body.reply_markup = { inline_keyboard: m.kb };
  else if (panelQator(m.url)) body.reply_markup = { inline_keyboard: [panelQator(m.url)] };
  try { return await tg("sendMessage", body); }
  catch (e) {
    if (e.code === 400 && /parse|entit/i.test(e.message)) return tg("sendMessage", { ...body, text: plain(m.html), parse_mode: undefined });
    throw e;
  }
}

export const YORDAM = [
  "🤖 <b>Murabbiy</b> — qo‘ng‘iroqlaringiz bo‘yicha shaxsiy murabbiy va tezkor raqamlar (/menyu).",
  "",
  "Har tahlil qilingan qo‘ng‘iroqdan keyin karta keladi: ball, gapirish balansi, maslahat va bitta vazifa (✅ Bajardim · ⏰ +1 soat · 💬 Sabab). Ertalab — bugungi mahorat, kun oxirida — kun yakuni.",
  "",
  "/menyu — tezkor raqamlar, tugmalar bilan",
  "/oxirgi — oxirgi qo‘ng‘iroq kartasi",
  "/bugun — bugungi kun yakuni",
  "/vazifa — ochiq vazifalarim",
  "/dars — bugungi mahorat bo‘yicha mini-dars (yoki: /dars e’tiroz)",
  "/mezon — 30 kunlik mezonlaringiz",
  "Mijoz ismi yoki lid raqami — shu suhbat kartasi (masalan: «Aziz bilan suhbatim»)",
  "",
  "/kun — faqat kun yakuni · /har — har qo‘ng‘iroq",
  "/tinch — to‘xtatish · /davom — qayta yoqish · /uzish — botni uzish",
  "",
  "Rahbarga: /jamoa — jamoa xulosasi · /sinov [login] — operator kartasi, vazifasi va mahoratini sinab ko‘rish",
].join("\n");
export const BUYRUQ = [
  { command: "menyu", description: "Tezkor raqamlar — tugmalar" },
  { command: "oxirgi", description: "Oxirgi qo‘ng‘iroq kartasi" },
  { command: "bugun", description: "Bugungi kun yakuni" },
  { command: "vazifa", description: "Ochiq vazifalarim" },
  { command: "dars", description: "Bugungi mahorat — mini-dars" },
  { command: "mezon", description: "30 kunlik mezonlarim" },
  { command: "tinch", description: "Xabarlarni to‘xtatish" },
  { command: "davom", description: "Xabarlarni qayta yoqish" },
  { command: "yordam", description: "Yordam" },
];

// ---------------------------------------------------------------- ishga tushirish (server.mjs → listen)
// kunStat(sana) → Map(owner → {total, missed, answered, talk}) — CRM'dagi kunlik qo'ng'iroqlar (serverda calls.calls).
// tezkorCtx — panel funksiyalari (server.mjs): tezkor ctx + leadsScoped(R, scope). Yo'q bo'lsa tugmalar «hisoblab bo'lmadi» deydi.
// fon=false — poll va taymerlar ishga tushmaydi (testlar handle() ni o'zi chaqiradi).
export function ishgaTushir({ db, log = console.log, audit = () => {}, kunStat = async () => new Map(), tezkorCtx = null, fon = true } = {}) {
  init(db);
  const faol = () => !!token() && sozlama(db).faol;
  let offset = Number(meta(db, "offset") || 0);
  let botAt = 0, band = false, kunBand = false;

  const linkOf = (chat) => db.prepare(`SELECT l.*, u.name, u.role, u.login, u.bitrix_user_id owner FROM coach_links l
    JOIN users u ON u.id=l.user_id WHERE l.chat_id=?`).get(String(chat));
  const javob = (chat, html, extra = {}) => yubor(chat, { html, ...extra }).catch((e) => log(`javob XATO ${e.message}`));

  async function ulash(msg, tok) {
    const chat = String(msg.chat.id);
    const t = db.prepare("SELECT * FROM coach_tokens WHERE token=?").get(tok);
    if (!t || t.used_at || t.expires < Date.now()) return javob(chat, "⏳ Havola eskirgan yoki ishlatilgan. Panelda Qo‘ng‘iroqlar → Murabbiy → «Telegram’da ulash» ni qayta bosing.");
    const u = db.prepare("SELECT id, name, login, role, bitrix_user_id FROM users WHERE id=?").get(t.user_id);
    if (!u) return javob(chat, "Hisob topilmadi.");
    const nm = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") + (msg.from?.username ? ` (@${msg.from.username})` : "");
    db.prepare("DELETE FROM coach_links WHERE chat_id=? AND user_id<>?").run(chat, u.id);   // bitta chat — bitta hisob
    db.prepare(`INSERT INTO coach_links (user_id, chat_id, tg_name, linked_at) VALUES (?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id, tg_name=excluded.tg_name, linked_at=excluded.linked_at, paused=0`)
      .run(u.id, chat, kes(nm, 80) || null, new Date().toISOString());
    V.kochir(db, u.id, chat);                                         // R13: ochiq vazifalar tugmalari yangi chatda ishlasin
    db.prepare("UPDATE coach_tokens SET used_at=? WHERE token=?").run(new Date().toISOString(), tok);
    audit("murabbiy.ulash", `user:${u.id}`, `${u.login} → Telegram ${kes(nm, 60)}${t.by_user && t.by_user !== u.id ? ` (havola: user:${t.by_user})` : ""}`);
    log(`ulandi: ${u.login}`);
    const hasCrm = !!u.bitrix_user_id;
    await javob(chat, [`✅ Ulandingiz, ${esc(kes(u.name, 40))}!`, "",
      hasCrm ? "Endi har tahlil qilingan qo‘ng‘iroqdan keyin shu yerga karta keladi, kun oxirida — kun yakuni. Buni faqat siz ko‘rasiz."
             : "Sizning hisobingizda CRM ID yo‘q — shaxsiy kartalar kelmaydi. /namuna — jamoadagi oxirgi karta namunasi.",
      "", YORDAM].join("\n"));
  }

  // Tezkor raqamlar menyusi (lib/menyu.mjs). Har bosishda bog'lanish va rol qayta tekshiriladi.
  const menyuUser = (l) => ({ role: l.role, owner: l.owner ? String(l.owner) : null });
  async function menyuYubor(chat, l) {
    const kb = menyu.klaviatura(menyuUser(l), PANEL);
    if (!kb) return javob(chat, menyu.menyuRoli(l.role) && !l.owner
      ? `Hisobingiz CRM’ga bog‘lanmagan — tugmalar yo‘q. Administratorga ayting.\n\n${YORDAM}` : YORDAM);
    return javob(chat, "📊 <b>Tezkor raqamlar</b>\nTugmani bosing — raqamni panel hisoblaydi (1–5 soniya).\nBarcha buyruqlar — /yordam", { kb });
  }
  // poll() tugmani kutmaydi (sovuq keshda gigiena o'nlab soniya) — bir chatda bittadan, hammasi bo'lib 4 tadan ko'p emas
  const bosildi = new Map();                                          // chat → oxirgi tugagan bosish: ketma-ket bosish CRM'ni yuklamasin
  const ishda = new Set();
  async function tugma(cq) {
    const ok = (text) => tg("answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text } : {}) }).catch(() => {});
    const m = cq.message, data = String(cq.data || "");
    // Faqat shaxsiy chat va faqat shu chat egasi: guruhdagi yoki boshqa odam bosgan tugma hech narsa ochmaydi
    if (!m?.chat || m.chat.type !== "private" || cq.from?.is_bot || String(cq.from?.id) !== String(m.chat.id)) return ok();
    if (data.startsWith(VZ_PREFIKS)) return vazifaTugma(String(m.chat.id), data, ok);
    if (!data.startsWith(menyu.PREFIKS)) return ok();
    const chat = String(m.chat.id), l = linkOf(chat);
    if (!l) return ok("Avval panel orqali ulaning");
    const key = data.slice(menyu.PREFIKS.length), t = menyu.tugmaOf(key);
    if (!t) return ok();
    if (ishda.has(chat)) return ok("⏳ Hisoblanmoqda…");
    if (Date.now() - (bosildi.get(chat) || 0) < 2000) return ok("⏳ Bir soniya…");
    if (ishda.size >= 4) return ok("⏳ Band, bir necha soniyadan keyin bosing");
    ishda.add(chat);
    try {
      await ok();
      db.prepare("UPDATE coach_links SET paused=0 WHERE user_id=? AND paused=2").run(l.user_id);   // bosgan — demak bloklamagan
      audit("murabbiy.tugma", `user:${l.user_id}`, key);
      if (t.buyruq) return await handle({ message: { chat: m.chat, from: cq.from, text: `/${t.buyruq}` } });
      const matn = await menyu.javob(key, menyuUser(l), tezkorCtx, Date.now(), log).catch((e) => { log(`tugma XATO ${key}: ${e.message}`); return menyu.XATO; });
      return await javob(chat, esc(matn || menyu.XATO), { kb: menyu.klaviatura(menyuUser(l), PANEL) });
    } finally { ishda.delete(chat); bosildi.set(chat, Date.now()); }
  }

  // Vazifa tugmalari (lib/murabbiy-vazifa.mjs tugmalar): mv:ok|surish|sabab:<id>. Vazifa shu chatga VA shu hisobga
  // berilgan bo'lishi shart — boshqa operatorning vazifa raqamini yuborib yopib/surib bo'lmaydi.
  // «Sabab» bosilgan — keyingi oddiy matn izoh. coach_meta kutish:<chat> = {"id":<vazifa>,"at":<ms>}; 30 daqiqada eskiradi (R10),
  // eskirgan yoki buzilgan qiymat o'chiriladi va matn odatdagi qidiruvga ketadi.
  const KUTISH_MS = 30 * 60e3;
  const kutishK = (chat) => `kutish:${chat}`;
  const kutishQoy = (chat, id) => setMeta(db, kutishK(chat), JSON.stringify({ id, at: Date.now() }));
  function kutishOl(chat) {
    const v = meta(db, kutishK(chat));
    if (v == null) return null;
    let o = null;
    try { o = JSON.parse(v); } catch {}
    const id = Number(o?.id), at = Number(o?.at);
    if (Number.isInteger(id) && id > 0 && Number.isFinite(at) && Date.now() - at <= KUTISH_MS) return id;
    delMeta(db, kutishK(chat));
    return null;
  }
  async function vazifaTugma(chat, data, ok) {
    const mm = data.match(/^mv:(ok|surish|sabab):(\d{1,12})$/);
    if (!mm) return ok();
    const l = linkOf(chat);
    if (!l) return ok("Avval panel orqali ulaning");
    const amal = mm[1], id = Number(mm[2]);
    const t0 = db.prepare("SELECT * FROM coach_tasks WHERE id=?").get(id);
    if (!t0 || t0.chat_id !== chat || t0.user_id !== l.user_id) return ok("Bu vazifa topilmadi");
    db.prepare("UPDATE coach_links SET paused=0 WHERE user_id=? AND paused=2").run(l.user_id);   // bosgan — demak bloklamagan
    if (t0.state === "bekor") return ok("Bu vazifa yopilgan (panelda bekor qilingan)");
    if (t0.state !== "ochiq" && t0.state !== "kechikdi") return ok("Bu vazifa allaqachon bajarilgan ✅");
    audit("murabbiy.vazifa", `user:${l.user_id}`, `${amal} #${id}`);
    if (amal === "sabab") {
      kutishQoy(chat, id);
      await ok();
      return javob(chat, `💬 Vazifa #${id}: nima uchun bajarilmadi? Sababini 30 daqiqa ichida bitta xabar bilan yozing.\n<i>Bekor qilish — istalgan buyruq, masalan /yordam.</i>`);
    }
    const t = V.belgila(db, id, { chatId: chat, amal }, Date.now());
    if (!t) return ok("Bu vazifa topilmadi");
    if (amal === "ok") { await ok("✅ Bajarildi"); return javob(chat, `✅ Vazifa #${id} bajarildi`); }
    await ok("⏰ Surildi");
    return javob(chat, `⏰ Vazifa #${id}: yangi muddat <b>${muddat(t.due)}</b>`);
  }

  // /vazifa — ochiq va kechikkan vazifalar, har biriga tugmalar
  function vazifaRoyxat(userId) {
    const r = V.ochiqlar(db, userId);
    if (!r.length) return { html: "✅ Ochiq vazifangiz yo‘q. Yangi vazifa qo‘ng‘iroq kartasi bilan keladi." };
    const top = r.slice(0, 8);
    const L = [`📌 <b>Ochiq vazifalaringiz:</b> ${r.length} ta`, ""];
    for (const t of top) L.push(`• <b>#${t.id}</b> ${esc(kes(t.text, 120))} — muddat ${muddat(t.due)}${t.state === "kechikdi" ? " · ⏰ <b>kechikkan</b>" : ""}`);
    if (r.length > top.length) L.push(`…va yana ${r.length - top.length} ta — panelda «Vazifalar» doskasida`);
    L.push("", "<i>✅ — bajardim · ⏰ — +1 soat · 💬 — sabab yozish</i>");
    const kb = top.map((t) => [{ text: `✅ #${t.id}`, callback_data: `mv:ok:${t.id}` }, { text: `⏰ #${t.id}`, callback_data: `mv:surish:${t.id}` },
      { text: `💬 #${t.id}`, callback_data: `mv:sabab:${t.id}` }]);
    return { html: L.join("\n"), kb };
  }

  // /dars [mezon] — mezon berilmasa: bugungi fokus (coach_focus), u ham yo'q bo'lsa — oxirgi suhbatlardagi eng past mezon (yozilmaydi)
  const MEZONLAR = Object.values(QISQA).join(", ");
  function darsXabar(l, owner, text) {
    const arg = text.replace(/^\/dars(?:@\w+)?/i, "").trim();
    let crit = arg ? D.mezonTop(arg) : null;
    if (arg && !crit) return `🤔 «${esc(kes(arg, 40))}» mezonini topmadim. Mezonlar: ${esc(MEZONLAR)}.\nMasalan: /dars keyingi qadam`;
    if (!crit) crit = db.prepare("SELECT crit FROM coach_focus WHERE user_id=? AND day=?").get(l.user_id, bugun())?.crit
      || (owner ? D.fokus(db, owner)?.crit : null) || null;
    if (!crit) return `📘 Bugungi fokus hali aniqlanmagan — mezonni yozing, masalan: /dars e’tiroz\nMezonlar: ${esc(MEZONLAR)}.`;
    const q = owner ? D.iqtibos(db, owner, crit) : null;
    return D.dars(crit, { quote: q?.quote }) || "Bu mezon bo‘yicha dars yo‘q.";
  }

  // /sinov [login] — rahbar uchun ko'rinish: tanlangan (standart — oxirgi tahlil qilingan) operatorning oxirgi kartasi,
  // shu qo'ng'iroqqa beriladigan vazifa (taklif — yaratilmaydi) va ertalabki mahorat xabari. Bazaga hech narsa yozilmaydi.
  function sinovXabar(text) {
    const arg = text.replace(/^\/sinov(?:@\w+)?/i, "").trim();
    let u = null, owner = null;
    const userQ = "SELECT id, name, login, bitrix_user_id FROM users";
    if (arg) {
      u = db.prepare(`${userQ} WHERE lower(login)=lower(?)`).get(arg) || null;
      if (!u) return [`🔎 «${esc(kes(arg, 40))}» logini topilmadi. Masalan: /sinov ali — yoki loginsiz /sinov (oxirgi tahlil qilingan operator).`];
      owner = String(u.bitrix_user_id || "").trim();
      if (!owner) return [`${esc(kes(u.name, 40))} hisobida CRM ID yo‘q — karta va vazifa chiqmaydi.`];
    } else {
      owner = db.prepare("SELECT owner FROM coach_calls WHERE score IS NOT NULL AND dur>=? ORDER BY at DESC LIMIT 1").get(MIN_SEC)?.owner || null;
      if (!owner) return [`Hali karta chiqadigan (≥${MIN_SEC} s) tahlil qilingan qo‘ng‘iroq yo‘q.`];
      u = db.prepare(`${userQ} WHERE TRIM(bitrix_user_id)=? ORDER BY id LIMIT 1`).get(String(owner).trim()) || null;
    }
    const kim = u ? `${esc(kes(u.name, 40))} (${esc(u.login)})` : `CRM #${esc(owner)}`;
    const c = db.prepare("SELECT * FROM coach_calls WHERE owner=? AND score IS NOT NULL AND dur>=? ORDER BY at DESC LIMIT 1").get(owner, MIN_SEC);
    const k = c && karta(db, c.call_id);
    if (!k) return [`${kim}: karta chiqadigan (≥${MIN_SEC} s) tahlil qilingan qo‘ng‘iroq yo‘q.`];

    // Vazifa: faqat taklif (yarat emas); cheklovlar o'qib tekshiriladi
    let a = null;
    try { a = JSON.parse(db.prepare("SELECT json FROM call_analyses WHERE call_id=? AND status='ready'").get(c.call_id)?.json || "null"); } catch {}
    const now = Date.now(), tk = V.taklif(a, c, now);
    const berilgan = db.prepare("SELECT id, state FROM coach_tasks WHERE call_id=?").get(String(c.call_id));
    let vz;
    if (berilgan) vz = `📌 Bu qo‘ng‘iroqqa vazifa allaqachon berilgan: #${berilgan.id} (${esc(berilgan.state)}).`;
    else if (!tk) vz = `📌 Vazifa chiqmaydi: keyingi qadam mijoz tomonida yoki suhbat ${V.MIN_QADAM_SEK} s dan qisqa.`;
    else {
      vz = `📌 <b>Vazifa (taklif):</b> ${esc(tk.text)} · muddat ${muddat(tk.due)}`;
      const why = [];
      if (!sozlama(db).vazifa) why.push("sozlamada vazifalar o‘chirilgan");
      const eidBand = c.eid && db.prepare("SELECT id FROM coach_tasks WHERE eid=? AND state IN ('ochiq','kechikdi')").get(String(c.eid));
      if (eidBand) why.push(`shu CRM yozuvida ochiq vazifa bor (#${eidBand.id})`);
      if (u) {
        const [dan, gacha] = kunChegara(tkIso(now).slice(0, 10));
        if (db.prepare("SELECT COUNT(*) n FROM coach_tasks WHERE user_id=? AND created_at>=? AND created_at<?").get(u.id, dan, gacha).n >= V.MAX_KUN)
          why.push(`bugungi ${V.MAX_KUN} ta limit to‘lgan`);
      }
      if (why.length) vz += `\n⚠️ Hozir yaratilmas edi: ${why.join("; ")}.`;
    }

    // Mahorat: haqiqiy mahorat() — SAVEPOINT ichida, keyin bekor (coach_focus ga hech narsa qolmaydi)
    let mh = null;
    db.exec("SAVEPOINT murabbiy_sinov");
    try { mh = D.mahorat(db, { userId: -1, owner }, bugun()); }
    finally { db.exec("ROLLBACK TO murabbiy_sinov"); db.exec("RELEASE murabbiy_sinov"); }
    const yuborilgan = u && db.prepare("SELECT crit FROM coach_focus WHERE user_id=? AND day=?").get(u.id, bugun());

    return [
      { html: [`🧪 <b>Sinov</b> · ${kim}`, "<i>Faqat sizga ko‘rsatildi: operatorga yuborilmadi, bazaga yozilmadi.</i>", "", k.html, "", vz].join("\n"), url: k.url },
      { html: [`🧪 <b>Ertalabki mahorat xabari</b> · ${kim}`, "",
        mh ? mh.html : `🎯 Mahorat chiqmaydi: kamida 3 ta ≥60 s tahlil qilingan suhbat kerak.`,
        ...(yuborilgan ? ["", `<i>Bugun operatorga yuborilgan fokus: ${esc(QISQA[yuborilgan.crit] || yuborilgan.crit)}</i>`] : [])].join("\n") },
    ];
  }

  async function handle(u) {
    if (u.callback_query) return tugma(u.callback_query);
    const msg = u.message;
    if (!msg || !msg.chat || msg.chat.type !== "private" || msg.from?.is_bot) return;
    const chat = String(msg.chat.id);
    const text = String(msg.text || "").trim();
    const buyruqmi = text.startsWith("/") || /^menyu$/i.test(text);
    if (buyruqmi) delMeta(db, kutishK(chat));                         // sabab kutilayotganda buyruq — kutish bekor, buyruq bajariladi
    const st = text.match(/^\/start(?:@\w+)?\s+([\w-]{16,64})$/);
    if (st) return ulash(msg, st[1]);
    const l = linkOf(chat);
    if (!l) return javob(chat, "Bu bot Pitaka sotuv operatorlari uchun shaxsiy murabbiy.\nUlash: panelda Qo‘ng‘iroqlar → Murabbiy → «Telegram’da ulash».");
    db.prepare("UPDATE coach_links SET paused=CASE WHEN paused=2 THEN 0 ELSE paused END WHERE user_id=?").run(l.user_id);   // blokdan chiqqan
    // «💬 Sabab» bosilgan bo'lsa — shu oddiy matn vazifa izohi (belgila chat egaligini yana tekshiradi)
    const kut = buyruqmi ? null : kutishOl(chat);
    if (kut) {
      if (!text) return javob(chat, "✍️ Sababni matn bilan yozing (bekor qilish — /yordam).");
      delMeta(db, kutishK(chat));
      const t0 = db.prepare("SELECT state FROM coach_tasks WHERE id=?").get(kut);
      if (t0?.state === "bajarildi") return javob(chat, `✅ Vazifa #${kut} allaqachon bajarilgan — sabab kerak emas.`);
      const t = V.belgila(db, kut, { chatId: chat, amal: "sabab", note: text }, Date.now());
      if (!t) return javob(chat, "Vazifa topilmadi — sabab saqlanmadi.");
      audit("murabbiy.vazifa", `user:${l.user_id}`, `sabab #${t.id}`);
      return javob(chat, `📝 Vazifa #${t.id}: sabab saqlandi — «${esc(kes(text, 200))}»`);
    }
    // Rahbar so'ragan «kechikkan lid sababi» savoliga oddiy matn javob (sabab kutishdan KEYIN, qidiruvdan OLDIN)
    if (!buyruqmi && text && SO.javobQabul(db, chat, text, msg.reply_to_message?.message_id, Date.now())) {
      audit("murabbiy.sorov", `user:${l.user_id}`, "javob");
      return javob(chat, "✅ Javobingiz qabul qilindi — rahmat!");
    }
    const cmd = (text.match(/^\/(\w+)/) || [])[1]?.toLowerCase() || "";
    const owner = l.owner ? String(l.owner) : null;
    const leader = LEADER.includes(l.role);
    if (cmd === "start" || cmd === "menyu" || /^menyu$/i.test(text)) return menyuYubor(chat, l);
    if (cmd === "yordam" || cmd === "help") return javob(chat, YORDAM);
    if (cmd === "tinch") { rejim(db, l.user_id, { paused: true }); return javob(chat, "🔕 To‘xtatildi. Qayta yoqish — /davom"); }
    if (cmd === "davom") { rejim(db, l.user_id, { paused: false }); return javob(chat, "🔔 Yoqildi."); }
    if (cmd === "kun") { rejim(db, l.user_id, { mode: "kun" }); return javob(chat, "Endi faqat kun yakuni keladi. Har qo‘ng‘iroq — /har"); }
    if (cmd === "har") { rejim(db, l.user_id, { mode: "har" }); return javob(chat, "Endi har qo‘ng‘iroqdan keyin karta keladi."); }
    if (cmd === "uzish") { uzish(db, l.user_id); audit("murabbiy.uzish", `user:${l.user_id}`, `${l.login} — Telegram'dan`); return javob(chat, "Uzildi. Qayta ulash — panel orqali."); }
    if (cmd === "namuna" && leader) { const k = namuna(db, owner); return k ? yubor(chat, k) : javob(chat, "Hali tahlil qilingan qo‘ng‘iroq yo‘q."); }
    if ((cmd === "jamoa" || cmd === "sinov") && !leader) return javob(chat, YORDAM);
    if (cmd === "jamoa") return javob(chat, jamoa(db, bugun()) || "👥 Bugun jamoada hali faoliyat yo‘q — tahlil qilingan suhbat ham, kritik suhbat ham yo‘q.");
    if (cmd === "sinov") {
      for (const x of sinovXabar(text)) await (typeof x === "string" ? javob(chat, x) : javob(chat, x.html, x.url ? { url: x.url } : {}));
      return;
    }
    if (cmd === "vazifa") { const v = vazifaRoyxat(l.user_id); return javob(chat, v.html, v.kb ? { kb: v.kb } : {}); }
    if (cmd === "dars") return javob(chat, darsXabar(l, owner, text));
    if (!owner) return javob(chat, leader ? "Hisobingizda CRM ID yo‘q. /namuna — jamoadagi oxirgi karta." : "Hisobingiz CRM’ga bog‘lanmagan — administratorga ayting.");
    if (cmd === "oxirgi") {
      const r = db.prepare("SELECT call_id FROM coach_calls WHERE owner=? AND score IS NOT NULL ORDER BY at DESC LIMIT 1").get(owner);
      const k = r && karta(db, r.call_id);
      return k ? yubor(chat, k) : javob(chat, "Hali tahlil qilingan qo‘ng‘irog‘ingiz yo‘q.");
    }
    if (cmd === "bugun") {
      const sana = bugun();
      const m = await kunStat(sana).catch(() => new Map());
      const k = kunYakuni(db, owner, sana, m.get(owner) || null, { userId: l.user_id });
      return k ? yubor(chat, k) : javob(chat, "Bugun hali qo‘ng‘iroq yo‘q.");
    }
    if (cmd === "mezon") { const k = mezon(db, owner); return k ? yubor(chat, k) : javob(chat, "30 kunda tahlil qilingan qo‘ng‘iroq yo‘q."); }
    const qm = text.match(/^\/q_([\w]{1,30})$/);
    if (qm) {
      const r = db.prepare("SELECT call_id FROM coach_calls WHERE call_id=? AND owner=?").get(qm[1], owner);
      const k = r && karta(db, r.call_id);
      return k ? yubor(chat, k) : javob(chat, "Bu qo‘ng‘iroq topilmadi.");
    }
    if (cmd) return javob(chat, YORDAM);
    const hit = qidir(db, owner, text);
    if (!hit.length) return javob(chat, "🔎 Topilmadi. Mijoz ismini yoki lid raqamini yozing (oxirgi 30 kun). Yordam — /yordam");
    if (hit.length === 1) { const k = karta(db, hit[0].call_id); return k ? yubor(chat, k) : javob(chat, "Karta yig‘ilmadi."); }
    return javob(chat, ["🔎 Bir nechta suhbat topildi:", ...hit.map((r) => `• ${kunOy(r.at)} ${soat(r.at)} · ${esc(kes(r.title || r.cname || "mijoz", 34))} — ${r.score} ball → /q_${r.call_id}`)].join("\n"));
  }

  async function poll() {
    let pauza = 1000;
    for (;;) {
      if (!faol()) { await sleep(60e3); continue; }
      try {
        if (Date.now() - botAt > 6 * 3600e3) {
          const me = await tg("getMe", {});
          setMeta(db, "bot", me.username);
          if (meta(db, "profil") !== "v4") {
            await tg("setMyCommands", { commands: BUYRUQ }).catch(() => {});
            await tg("setMyDescription", { description: "Pitaka sotuv operatorlari uchun shaxsiy murabbiy: har qo‘ng‘iroqdan keyin ball, maslahat va bitta vazifa, ertalab — bugungi mahorat. Ulash — Pitaka sotuv paneli orqali." }).catch(() => {});
            await tg("setMyShortDescription", { short_description: "Qo‘ng‘iroqlaringiz bo‘yicha shaxsiy murabbiy" }).catch(() => {});
            setMeta(db, "profil", "v4");                                // v2: /menyu; v3: /vazifa, /dars; v4: Pitaka tavsifi (2026-11-10)
          }
          botAt = Date.now();
        }
        const ups = await tg("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] }, 40000);
        for (const up of ups) {
          offset = up.update_id + 1;
          setMeta(db, "offset", offset);
          if (up.callback_query) { handle(up).catch((e) => log(`tugma XATO: ${e.message}`)); continue; }   // kutmaymiz — bot to'xtamasin
          try { await handle(up); } catch (e) { log(`xabar XATO: ${e.message}`); }
        }
        setMeta(db, "poll_at", new Date().toISOString());
        pauza = 1000;
      } catch (e) {
        setMeta(db, "xato", kes(e.message, 200)); setMeta(db, "xato_at", new Date().toISOString());
        if (e.code === 401 || e.code === 404) { log("token Telegram'da qabul qilinmadi — 5 daqiqa kutiladi"); botAt = 0; await sleep(300e3); }
        else if (e.code === 409) { log("boshqa jarayon ham shu botni o'qiyapti (409) — 1 daqiqa"); await sleep(60e3); }
        else if (e.code === 429) await sleep(Math.max(5, e.retry || 30) * 1000);
        else { await sleep(pauza); pauza = Math.min(60e3, pauza * 2); }
      }
    }
  }

  // v2: karta bilan bitta vazifa. Faqat karta haqiqatan yuborilayotganda yaratiladi; oldingi urinishda yaratilib karta
  // yetib bormagan bo'lsa (tarmoq) — o'sha vazifa qayta ko'rsatiladi (yarat call_id bo'yicha ikkinchisini bermaydi).
  function kartaVazifasi(r) {
    const c = db.prepare("SELECT * FROM coach_calls WHERE call_id=?").get(String(r.call_id));
    let a = null;
    try { a = JSON.parse(db.prepare("SELECT json FROM call_analyses WHERE call_id=? AND status='ready'").get(String(r.call_id))?.json || "null"); } catch {}
    if (!c || !a) return null;
    return V.yarat(db, { userId: r.user_id, owner: c.owner, chatId: r.chat_id, call: c, a }, Date.now())
      || db.prepare("SELECT * FROM coach_tasks WHERE call_id=? AND chat_id=? AND user_id=? AND state IN ('ochiq','kechikdi')")
        .get(String(r.call_id), String(r.chat_id), r.user_id) || null;
  }

  // Har qo'ng'iroq kartasi — tahlil tugagach (≤30 s kechikish)
  async function navbat() {
    if (band || !faol()) return;
    band = true;
    try {
      const vazifaYoq = !sozlama(db).vazifa;
      const since = new Date(Date.now() - MAX_AGE_H * 3600e3).toISOString();
      const rows = db.prepare(`SELECT c.call_id, l.chat_id, l.user_id FROM coach_calls c
          JOIN users u ON u.bitrix_user_id = c.owner JOIN coach_links l ON l.user_id = u.id
          WHERE c.card_at IS NULL AND c.score IS NOT NULL AND c.dur >= ? AND c.at >= ? AND c.at >= strftime('%Y-%m-%dT%H:%M:%fZ', l.linked_at, '-1 hour')   -- ulanishdan 1 soat oldingisi ham
            AND l.paused = 0 AND l.mode = 'har'
          ORDER BY c.at LIMIT 10`).all(MIN_SEC, since);
      const seen = new Set();                                           // bitta CRM ID — ikki hisob bo'lsa ham bir karta
      for (const r of rows) {
        if (seen.has(r.call_id)) continue; seen.add(r.call_id);
        const now = new Date().toISOString();
        const k = karta(db, r.call_id);
        if (!k) { db.prepare("UPDATE coach_calls SET card_at=?, card_err=? WHERE call_id=?").run(now, "karta yig‘ilmadi", r.call_id); continue; }
        let t = null;
        if (!vazifaYoq) { try { t = kartaVazifasi(r); } catch (e) { log(`vazifa XATO ${r.call_id}: ${e.message}`); } }
        // karta + vazifa — bitta xabar; tugmalar ostida panel havolasi saqlanadi (R9)
        const m = t ? { html: `${k.html}\n\n${V.qator(t)}`, kb: [...V.tugmalar(t.id).inline_keyboard, ...(panelQator(k.url) ? [panelQator(k.url)] : [])] } : k;
        try {
          await yubor(r.chat_id, m);
          db.prepare("UPDATE coach_calls SET card_at=?, card_chat=?, card_err=NULL WHERE call_id=?").run(now, r.chat_id, r.call_id);
          db.prepare("UPDATE coach_links SET last_at=? WHERE user_id=?").run(now, r.user_id);
        } catch (e) {
          if (e.code === 403) { db.prepare("UPDATE coach_links SET paused=2 WHERE user_id=?").run(r.user_id); log(`user:${r.user_id} botni bloklagan — to'xtatildi`); }
          if (e.code === 429) { await sleep(Math.max(3, e.retry || 5) * 1000); break; }
          if (e.code === -1) break;                                     // tarmoq — keyingi siklda qayta (vazifa saqlanadi)
          db.prepare("UPDATE coach_calls SET card_at=?, card_chat=?, card_err=? WHERE call_id=?").run(now, r.chat_id, kes(e.message, 200), r.call_id);
          // R11: karta qayta urinilmaydi — vazifa operatorga yetib bormadi; limit, «berildi» va eid bandligiga kirmasin
          if (t) { try { V.bekor(db, t.id); } catch (e2) { log(`vazifa bekor XATO #${t.id}: ${e2.message}`); } }
        }
      }
    } finally { band = false; }
  }

  // Kun yakuni — belgilangan vaqtdan keyin 3 soat ichida (tunda xabar yo'q), faqat qo'ng'iroq bo'lgan kuni
  async function kunTick(ms = Date.now()) {
    if (kunBand || !faol()) return;
    const S = sozlama(db), now = tkIso(ms), sana = now.slice(0, 10), hm = now.slice(11, 16);
    if (hm < S.vaqt || daq(hm) - daq(S.vaqt) > 180) return;
    const links = db.prepare(`SELECT l.user_id, l.chat_id, u.bitrix_user_id owner FROM coach_links l JOIN users u ON u.id=l.user_id
      WHERE l.paused=0 AND u.bitrix_user_id IS NOT NULL AND u.bitrix_user_id<>''
        AND NOT EXISTS (SELECT 1 FROM coach_digest d WHERE d.user_id=l.user_id AND d.day=?)`).all(sana);
    if (!links.length) return;
    kunBand = true;
    try {
      const m = await kunStat(sana).catch((e) => { log(`kun statistikasi XATO: ${e.message}`); return new Map(); });
      for (const l of links) {
        const k = kunYakuni(db, l.owner, sana, m.get(String(l.owner)) || null, { userId: l.user_id });
        const mark = (note) => db.prepare("INSERT OR REPLACE INTO coach_digest (user_id, day, sent_at, note) VALUES (?,?,?,?)").run(l.user_id, sana, new Date().toISOString(), note);
        if (!k) { mark("faoliyat yo‘q"); continue; }
        try { await yubor(l.chat_id, k); mark(null); db.prepare("UPDATE coach_links SET last_at=? WHERE user_id=?").run(new Date().toISOString(), l.user_id); }
        catch (e) {
          if (e.code === -1 || e.code === 429) break;                   // keyingi daqiqada qayta
          if (e.code === 403) db.prepare("UPDATE coach_links SET paused=2 WHERE user_id=?").run(l.user_id);
          mark(`xato: ${kes(e.message, 120)}`);
        }
      }
    } finally { kunBand = false; }
  }

  // Ertalabki xabar (lib/ertalab.mjs): sotuvchiga o'z qadamsiz bitimlari, 09:00–12:00, yakshanbadan tashqari.
  // Odamlarga yangi turdagi xabar — faqat MURABBIY_ERTALAB=1 bo'lsa (yoqishni rahbar hal qiladi).
  let ertBand = false;
  async function ertalabTick(now = Date.now()) {
    if (ertBand || !faol() || process.env.MURABBIY_ERTALAB !== "1" || !tezkorCtx?.dealRows || !ert.vaqtmi(now)) return;
    const sana = ert.sanaTk(now), kim = ert.kimga(db, sana);
    if (!kim.length) return;
    ertBand = true;
    try {
      const rows = await Promise.resolve().then(() => tezkorCtx.dealRows()).catch((e) => { log(`ertalab: CRM XATO ${e.message}`); return null; });
      if (!Array.isArray(rows)) return;                               // CRM javob bermadi — belgilamaymiz, bir daqiqadan keyin qayta
      for (const k of kim) {
        const m = ert.xabar(rows, k.owner, { now, panelUrl: PANEL });
        if (!m) { ert.belgila(db, k.user_id, sana, "qadamsiz bitim yo‘q"); continue; }
        try { await yubor(k.chat_id, m); ert.belgila(db, k.user_id, sana); }
        catch (e) {
          if (e.code === -1 || e.code === 429) break;                 // tarmoq/limit — keyingi daqiqada qayta
          if (e.code === 403) db.prepare("UPDATE coach_links SET paused=2 WHERE user_id=?").run(k.user_id);
          ert.belgila(db, k.user_id, sana, `xato: ${kes(e.message, 120)}`);
        }
      }
    } finally { ertBand = false; }
  }

  // v2 vazifalar (har 120 s): avto-tekshiruv natijasi operatorga; muddati o'tganiga bitta eslatma — faqat ish vaqtida
  // (Toshkent 09:00–19:00, yakshanbasiz), tunda o'tganlari ertalab ketadi. Faqat ulangan va to'xtatmagan operatorga.
  // Avto-yopish xabari bazada kuzatiladi (notified_at): tarmoq/429 da yo'qolmaydi — keyingi tick'da qayta yuboriladi.
  let vzBand = false;
  async function vazifaTick(now = Date.now()) {
    if (vzBand || !faol() || !sozlama(db).vazifa) return;
    vzBand = true;
    try {
      const faolMi = (t) => !!t.chat_id && !!db.prepare("SELECT 1 FROM coach_links WHERE chat_id=? AND user_id=? AND paused=0").get(String(t.chat_id), t.user_id);
      const blok = (uid) => db.prepare("UPDATE coach_links SET paused=2 WHERE user_id=?").run(uid);
      V.tekshir(db, now);                                               // bazada yopadi; xabarlar — notified_at IS NULL bo'yicha
      for (const t of V.xabarsizlar(db)) {
        if (!faolMi(t)) { V.xabarlandi(db, t.id, now); continue; }       // to'xtatgan/uzilgan — xabarsiz (keyin ham ketmaydi)
        try {
          await yubor(t.chat_id, { html: `✅ Vazifa #${t.id} bajarildi — ${esc(t.evidence)}\n<i>${esc(kes(t.text, 160))}</i>` });
          V.xabarlandi(db, t.id, now);
        } catch (e) {
          log(`vazifa xabari XATO #${t.id}: ${e.message}`);
          if (e.code === -1 || e.code === 429) return;                  // tarmoq/limit — bu va qolganlari keyingi tick'da
          if (e.code === 403) blok(t.user_id);
          V.xabarlandi(db, t.id, now);                                  // boshqa xato — cheksiz qayta urinilmaydi
        }
      }
      if (!ishdami(now)) return;
      for (const t of V.eslatmalar(db, now)) {
        if (!faolMi(t)) { V.eslatildi(db, t.id, now); continue; }       // to'xtatgan/uzilgan — xabarsiz, holat «kechikdi»
        try {
          await yubor(t.chat_id, { html: `⏰ Vazifa #${t.id} muddati o'tdi: ${esc(t.text)}`, kb: V.tugmalar(t.id).inline_keyboard });
          V.eslatildi(db, t.id, now);
        } catch (e) {
          if (e.code === -1 || e.code === 429) break;                   // keyingi tick'da qayta
          if (e.code === 403) blok(t.user_id);
          V.eslatildi(db, t.id, now);                                   // boshqa xato — cheksiz qayta urinilmaydi
          log(`eslatma XATO #${t.id}: ${e.message}`);
        }
      }
    } finally { vzBand = false; }
  }

  // v2 «Bugungi mahorat»: ish kunlari 09:00–11:00, kuniga bir marta (coach_focus). mahorat() qatorni yuborishdan OLDIN
  // yozadi — tarmoq/429 da qator o'chiriladi va keyingi daqiqada qayta urinadi; boshqa xatoda kun ishlatilgan hisoblanadi;
  // 403 — paused=2 (R8, R12).
  let mhBand = false;
  async function mahoratTick(now = Date.now()) {
    if (mhBand || !faol() || !sozlama(db).mahorat) return;
    const t = tkIso(now), sana = t.slice(0, 10), hm = t.slice(11, 16);
    if (yakshanba(now) || hm < "09:00" || hm > "11:00") return;
    const kim = db.prepare(`SELECT l.user_id, l.chat_id, TRIM(u.bitrix_user_id) owner FROM coach_links l JOIN users u ON u.id=l.user_id
      WHERE l.paused=0 AND u.bitrix_user_id IS NOT NULL AND TRIM(u.bitrix_user_id)<>''
        AND NOT EXISTS (SELECT 1 FROM coach_focus f WHERE f.user_id=l.user_id AND f.day=?)`).all(sana);
    if (!kim.length) return;
    mhBand = true;
    try {
      for (const k of kim) {
        const m = D.mahorat(db, { userId: k.user_id, owner: k.owner }, sana);
        if (!m) continue;                                               // suhbat kam — fokus yo'q (bazaga yozilmagan)
        try {
          await yubor(k.chat_id, { html: m.html });
          db.prepare("UPDATE coach_links SET last_at=? WHERE user_id=?").run(new Date().toISOString(), k.user_id);
        } catch (e) {
          if (e.code === 403) { db.prepare("UPDATE coach_links SET paused=2 WHERE user_id=?").run(k.user_id); continue; }
          if (e.code === -1 || e.code === 429) {                        // vaqtinchalik — keyingi daqiqada qayta
            db.prepare("DELETE FROM coach_focus WHERE user_id=? AND day=?").run(k.user_id, sana);
            log(`mahorat: tarmoq/limit user:${k.user_id} — keyingi daqiqada qayta: ${e.message}`);
            break;
          }
          log(`mahorat XATO user:${k.user_id} (bugun qayta urinilmaydi): ${e.message}`);
        }
      }
    } finally { mhBand = false; }
  }

  // v2 jamoa xulosasi: rahbarlarga (LEADER) har kuni 18:45–21:45, bir marta (coach_meta jamoa:<user_id> = sana)
  let jmBand = false;
  async function jamoaTick(now = Date.now()) {
    if (jmBand || !faol()) return;
    const t = tkIso(now), sana = t.slice(0, 10), hm = t.slice(11, 16);
    if (hm < "18:45" || hm > "21:45") return;
    const kim = db.prepare(`SELECT l.user_id, l.chat_id FROM coach_links l JOIN users u ON u.id=l.user_id
      WHERE l.paused=0 AND u.role IN (${LEADER.map(() => "?").join(",")})`).all(...LEADER)
      .filter((r) => meta(db, `jamoa:${r.user_id}`) !== sana);
    if (!kim.length) return;
    jmBand = true;
    try {
      const html = jamoa(db, sana);
      for (const r of kim) {
        const bel = () => setMeta(db, `jamoa:${r.user_id}`, sana);
        if (!html) { bel(); continue; }                                 // bugun faoliyat yo'q — xabar yo'q
        try {
          await yubor(r.chat_id, { html });
          bel();
          db.prepare("UPDATE coach_links SET last_at=? WHERE user_id=?").run(new Date().toISOString(), r.user_id);
        } catch (e) {
          if (e.code === -1 || e.code === 429) break;                   // keyingi daqiqada qayta
          if (e.code === 403) db.prepare("UPDATE coach_links SET paused=2 WHERE user_id=?").run(r.user_id);
          bel();
          log(`jamoa XATO user:${r.user_id}: ${e.message}`);
        }
      }
    } finally { jmBand = false; }
  }

  // v2 so'rov: rahbar CLI bilan yozgan savollarni yuboradi (faqat ish vaqtida: du–sha 09:00–19:00 Toshkent), muddat o'tgach rahbarlarga
  // xulosa (har rahbarga bir marta: coach_meta sorov:<id>:<user>; hammasi ketgach xulosa_at). Tarmoq/429 — keyingi tick'da.
  let srBand = false;
  async function sorovTick(now = Date.now()) {
    if (srBand || !faol()) return;
    srBand = true;
    try {
      const blok = (uid) => db.prepare("UPDATE coach_links SET paused=2 WHERE user_id=?").run(uid);
      // Ish vaqtidan tashqarida (yakshanba, 19:00–09:00) savol ham, rahbar xulosasi ham ketmaydi — keyingi ish tick'ida ketadi
      if (!ishdami(now)) return;
      for (const q of SO.yuboriladi(db, now)) {
        try {
          const r = await yubor(q.cur_chat, { html: SO.xabar(q) });
          SO.yuborildi(db, q.id, r?.message_id, now, q.cur_chat);
          db.prepare("UPDATE coach_links SET last_at=? WHERE user_id=?").run(new Date().toISOString(), q.user_id);
        } catch (e) {
          if (e.code === -1 || e.code === 429) { log(`sorov: tarmoq/limit — keyingi tick'da qayta: ${e.message}`); return; }
          if (e.code === 403) blok(q.user_id);
          log(`sorov XATO user:${q.user_id}: ${e.message}`);
        }
      }
      for (const { id } of SO.tugagan(db, now)) {
        const n = SO.natija(db, id);
        const kim = db.prepare(`SELECT l.user_id, l.chat_id FROM coach_links l JOIN users u ON u.id=l.user_id
          WHERE l.paused=0 AND u.role IN (${LEADER.map(() => "?").join(",")})`).all(...LEADER)
          .filter((r) => meta(db, `sorov:${id}:${r.user_id}`) == null);
        // R14: ulangan rahbar yo'q — xulosa kutadi (xulosa_at qo'yilmaydi), bir marta yoziladi; rahbar ulangach ketadi
        if (!db.prepare(`SELECT 1 FROM coach_links l JOIN users u ON u.id=l.user_id WHERE l.paused=0 AND u.role IN (${LEADER.map(() => "?").join(",")})`).get(...LEADER)) {
          if (meta(db, `sorov:${id}:lidersiz`) == null) { setMeta(db, `sorov:${id}:lidersiz`, "1"); log(`sorov #${id}: ulangan rahbar yo'q — xulosa kutadi`); }
          continue;
        }
        let tugadi = true;
        for (const r of kim) {
          try {
            await yubor(r.chat_id, { html: n.html });
            setMeta(db, `sorov:${id}:${r.user_id}`, "1");
          } catch (e) {
            if (e.code === -1 || e.code === 429) { tugadi = false; break; }
            if (e.code === 403) blok(r.user_id);
            setMeta(db, `sorov:${id}:${r.user_id}`, "xato");
            log(`sorov xulosa XATO user:${r.user_id}: ${e.message}`);
          }
        }
        if (!tugadi) return;
        SO.xulosalandi(db, id, now);
      }
    } finally { srBand = false; }
  }

  const API = { navbat, kunTick, ertalabTick, vazifaTick, mahoratTick, jamoaTick, sorovTick, handle };
  if (!fon) return API;
  poll().catch((e) => log(`poll to'xtadi: ${e.message}`));
  const t1 = setInterval(() => { navbat().catch((e) => log(`navbat XATO: ${e.message}`)); }, 30e3); t1.unref?.();
  const t2 = setInterval(() => { kunTick().catch((e) => log(`kun yakuni XATO: ${e.message}`)); }, 60e3); t2.unref?.();
  const t3 = setInterval(() => { ertalabTick().catch((e) => log(`ertalab XATO: ${e.message}`)); }, 60e3); t3.unref?.();
  const t4 = setInterval(() => { vazifaTick().catch((e) => log(`vazifa XATO: ${e.message}`)); }, 120e3); t4.unref?.();
  const t5 = setInterval(() => { mahoratTick().catch((e) => log(`mahorat XATO: ${e.message}`)); }, 60e3); t5.unref?.();
  const t6 = setInterval(() => { jamoaTick().catch((e) => log(`jamoa XATO: ${e.message}`)); }, 60e3); t6.unref?.();
  const t7 = setInterval(() => { sorovTick().catch((e) => log(`sorov XATO: ${e.message}`)); }, 60e3); t7.unref?.();
  return API;
}

// ---------------------------------------------------------------- bir martalik to'ldirish
// Xususiyat ishga tushishidan oldingi tahlillar uchun egani CRM reyestridan olib coach_calls ga yozadi —
// «o'rtachangiz» va /mezon birinchi kundanoq to'g'ri chiqsin. Karta yuborilmaydi (card_at belgilanadi).
export async function toldir(db, registry, { log = console.log } = {}) {
  init(db);
  if (meta(db, "backfill") === "v1") return { skip: true };
  const reg = await registry();
  const has = db.prepare("SELECT 1 FROM coach_calls WHERE call_id=?");
  const js = db.prepare("SELECT json FROM call_analyses WHERE call_id=? AND status='ready'");
  const bel = db.prepare("UPDATE coach_calls SET card_at=COALESCE(card_at, ?), card_err=COALESCE(card_err, 'oldingi') WHERE call_id=?");
  let n = 0, i = 0;
  for (const r of reg.rows || []) {
    if (++i % 40 === 0) await new Promise((res) => setImmediate(res));   // panel so'rovlari to'xtab qolmasin
    if (has.get(String(r.id))) continue;
    const row = js.get(String(r.id)); if (!row) continue;
    let a; try { a = JSON.parse(row.json); } catch { continue; }
    qayd(db, r.id, a, r);
    bel.run(new Date().toISOString(), String(r.id));
    n++;
  }
  setMeta(db, "backfill", "v1");
  log(`to'ldirildi: ${n} ta tahlil`);
  return { n };
}
