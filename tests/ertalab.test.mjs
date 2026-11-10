// node --test tests/ertalab.test.mjs — tarmoq yo'q, CRM yo'q: qatorlar soxta, baza xotirada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { xabar, vaqtmi, kimga, belgila, init, sanaTk, yashir } from "../lib/ertalab.mjs";

const NOW = Date.UTC(2026, 9, 27, 4, 30);   // seshanba, 09:30 Toshkent
const tk = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh - 5, mm);   // Toshkent devor soati → ms

// hygiene scan() qatori
const bitim = (o = {}) => ({ id: "1", title: "Bitim", owner: "14", category: "B2C", stage: "Taklif yuborildi",
  amount: 0, currency: "UZS", idleDays: 3, hasNextStep: false, issues: ["qadam"], severity: 1, archive: false,
  url: "http://127.0.0.1:8099/crm/deal/details/1/", ...o });
const qatorlar = (html) => html.split("\n").filter((s) => s.startsWith("• "));

// ---------------------------------------------------------------- xabar
test("faqat o'z bitimlari sanaladi", () => {
  const rows = [
    bitim({ id: "1", title: "Aziz — iPhone 17 Pro chexol" }),
    bitim({ id: "2", title: "Bekzod — Samsung S24 Ultra chexol" }),
    bitim({ id: "3", title: "Ofis Chilonzor", owner: 14 }),          // raqam ko'rinishidagi owner ham o'ziniki
    bitim({ id: "4", title: "BOSHQANIKI", owner: "155" }),
    bitim({ id: "5", title: "YANA BOSHQANIKI", owner: "?" }),
  ];
  const m = xabar(rows, "14", { now: NOW });
  assert.ok(m);
  assert.match(m.html, /bitimlaringiz: <b>3<\/b> ta/);
  assert.equal(m.n, 3);
  assert.equal(qatorlar(m.html).length, 3);
  assert.ok(!m.html.includes("BOSHQANIKI"));
  assert.ok(m.html.startsWith("☀️ <b>Xayrli tong!</b> · 27-oktabr"));
  assert.equal(xabar(rows, 14, { now: NOW }).n, 3);                   // owner raqam bo'lsa ham
  assert.equal(xabar(rows, "155", { now: NOW }).n, 1);
});

test("arxiv va keyingi qadami borlari chiqarilmaydi", () => {
  const rows = [
    bitim({ id: "1", title: "Kerakli" }),
    bitim({ id: "2", title: "ARXIVDAGI", archive: true, idleDays: 400 }),
    bitim({ id: "3", title: "QADAMI BOR", hasNextStep: true, issues: ["sana", "summa"] }),
    bitim({ id: "4", title: "TOZA", hasNextStep: true, issues: [] }),
    bitim({ id: "5", title: "ISSUESSIZ", issues: undefined }),
  ];
  const m = xabar(rows, "14", { now: NOW });
  assert.equal(m.n, 1);
  assert.match(m.html, /Kerakli/);
  for (const s of ["ARXIVDAGI", "QADAMI BOR", "TOZA", "ISSUESSIZ"]) assert.ok(!m.html.includes(s), s);
});

test("yuboradigan narsa bo'lmasa — null", () => {
  assert.equal(xabar([], "14"), null);
  assert.equal(xabar(null, "14"), null);
  assert.equal(xabar([bitim({ issues: ["sana"] })], "14"), null);
  assert.equal(xabar([bitim({ archive: true })], "14"), null);
  assert.equal(xabar([bitim()], "999"), null);
  assert.equal(xabar([bitim()], ""), null);
  assert.equal(xabar([bitim()], null), null);
});

test("HTML: nom va bosqich ekranlanadi", () => {
  const m = xabar([bitim({ title: "Ali <b>& Co", stage: "Yangi <i>\"tez\"</i>" })], "14", { now: NOW });
  assert.ok(m.html.includes("Ali &lt;b&gt;&amp; Co"));
  assert.ok(m.html.includes("Yangi &lt;i&gt;&quot;tez&quot;&lt;/i&gt;"));
  assert.ok(!m.html.includes("<b>&"));
  assert.ok(!m.html.includes("<i>"));
  // ruxsat etilgan teglar — faqat b
  const teglar = m.html.match(/<\/?[a-z]+>/g) || [];
  assert.ok(teglar.every((t) => /^<\/?b>$/.test(t)), teglar.join(" "));
});

test("top-5: summa, keyin harakatsizlik bo'yicha; qolgani «va yana»", () => {
  const rows = [
    bitim({ id: "1", title: "A kichik", amount: 1_000_000, idleDays: 50 }),
    bitim({ id: "2", title: "B katta", amount: 12_500_000, idleDays: 2 }),
    bitim({ id: "3", title: "C teng-yangi", amount: 5_000_000, idleDays: 1 }),
    bitim({ id: "4", title: "D teng-eski", amount: 5_000_000, idleDays: 40 }),
    bitim({ id: "5", title: "E summasiz-eski", amount: 0, idleDays: 200 }),
    bitim({ id: "6", title: "F summasiz-yangi", amount: 0, idleDays: 5 }),
    bitim({ id: "7", title: "G o'rta", amount: 3_000_000, idleDays: 9 }),
  ];
  const m = xabar(rows, "14", { now: NOW });
  const q = qatorlar(m.html);
  assert.equal(m.n, 7);
  assert.equal(q.length, 5);
  assert.deepEqual(q.map((s) => s.slice(2, 3)), ["B", "D", "C", "G", "A"]);
  assert.match(m.html, /\n…va yana 2 ta\n/);
  assert.ok(q[0].includes("<b>12 500 000 so‘m</b>"));
  assert.ok(q[0].includes("Taklif yuborildi, 2 kun harakatsiz"));
  assert.ok(!m.html.includes("E summasiz"));
  assert.match(m.html, /💡 .*keyingi qadam.*sana/);
  // 5 va undan kam bo'lsa «va yana» yo'q
  assert.ok(!xabar(rows.slice(0, 5), "14", { now: NOW }).html.includes("va yana"));
});

test("summasiz bitimda pul yozilmaydi; boshqa valyuta o'z kodi bilan", () => {
  const m = xabar([bitim({ title: "Summasiz", amount: 0 }), bitim({ title: "Dollar", amount: 15000, currency: "USD" })], "14", { now: NOW });
  const [usd, nol] = qatorlar(m.html);
  assert.ok(usd.includes("<b>15 000 USD</b>"));
  assert.ok(!nol.includes("so‘m"));
  assert.ok(!nol.includes("<b>"));
});

test("telefon, pochta va CRM havolasi xabarga tushmaydi", () => {
  const rows = [
    bitim({ id: "9001", title: "Aziz +998 90 123-45-67 aziz.k@mail.uz", contactId: "4521", amount: 450_000_000 }),
    bitim({ id: "9002", title: "(90) 1234567 Lola" }),
    bitim({ id: "9003", title: "SES 450 000 000 so'mlik" }),
  ];
  const m = xabar(rows, "14", { now: NOW });
  assert.ok(!/\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/.test(m.html.replace(/\d{1,3}(?: \d{3})+ so‘m/g, "")), m.html);
  assert.ok(!m.html.includes("@"));
  assert.ok(!m.html.includes("4521"));
  assert.ok(!m.html.includes("9001") && !m.html.includes("crm/deal"));
  assert.ok(m.html.includes("[tel]") && m.html.includes("[pochta]"));
  assert.ok(m.html.includes("SES 450 000 000"));                    // summa telefon emas
  assert.equal(yashir("tel 901234567"), "tel [tel]");
  assert.equal(yashir("998 90 123 45 67"), "[tel]");
});

test("url: faqat https panel bo'lsa", () => {
  const r = [bitim()];
  assert.equal(xabar(r, "14", { panelUrl: "https://sotuv.example.uz/" }).url, "https://sotuv.example.uz/#gigiena");
  assert.equal(xabar(r, "14", { panelUrl: "https://sotuv.example.uz" }).url, "https://sotuv.example.uz/#gigiena");
  assert.equal(xabar(r, "14", { panelUrl: "http://127.0.0.1:8080" }).url, undefined);
  assert.equal(xabar(r, "14", { panelUrl: "javascript:alert(1)" }).url, undefined);
  assert.equal(xabar(r, "14").url, undefined);
});

// ---------------------------------------------------------------- vaqtmi
test("vaqtmi: seshanba 09:30 — ha; 08:59, 12:01 va yakshanba — yo'q", () => {
  assert.equal(vaqtmi(tk(2026, 10, 27, 9, 30)), true);     // seshanba
  assert.equal(vaqtmi(tk(2026, 10, 27, 8, 59)), false);
  assert.equal(vaqtmi(tk(2026, 10, 27, 12, 1)), false);
  assert.equal(vaqtmi(tk(2026, 11, 1, 9, 30)), false);     // yakshanba
  assert.equal(vaqtmi(NOW), true);
});

test("vaqtmi: chegaralar, shanba, sozlamalar", () => {
  assert.equal(vaqtmi(tk(2026, 10, 27, 9, 0)), true);
  assert.equal(vaqtmi(tk(2026, 10, 27, 12, 0)), true);
  assert.equal(vaqtmi(tk(2026, 10, 31, 10, 0)), true);                                  // shanba — ish kuni
  assert.equal(vaqtmi(tk(2026, 10, 31, 10, 0), { ishKunlari: [1, 2, 3, 4, 5] }), false);
  assert.equal(vaqtmi(tk(2026, 11, 1, 9, 30), { ishKunlari: [7] }), true);
  assert.equal(vaqtmi(tk(2026, 10, 27, 8, 45), { vaqt: "08:30", oyna: 30 }), true);
  assert.equal(vaqtmi(tk(2026, 10, 27, 9, 1), { vaqt: "08:30", oyna: 30 }), false);
  assert.equal(vaqtmi(tk(2026, 10, 27, 9, 30), { vaqt: "9:00" }), true);               // noto'g'ri vaqt → 09:00
  assert.equal(vaqtmi(NaN), false);
  assert.equal(vaqtmi(undefined), false);
});

test("vaqtmi: hafta kuni UTC emas, Toshkent bo'yicha", () => {
  // Toshkent dushanba 02:00 = UTC yakshanba 21:00
  const t = tk(2026, 10, 26, 2, 0);
  assert.equal(new Date(t).getUTCDay(), 0);
  assert.equal(vaqtmi(t, { vaqt: "01:00", ishKunlari: [1] }), true);
  assert.equal(vaqtmi(t, { vaqt: "01:00", ishKunlari: [7] }), false);
  assert.equal(sanaTk(t), "2026-10-26");
});

// ---------------------------------------------------------------- kimga / belgila
function baza() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, login TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'menejer', pass TEXT NOT NULL DEFAULT '', bitrix_user_id TEXT);
    CREATE TABLE coach_links (user_id INTEGER PRIMARY KEY, chat_id TEXT NOT NULL UNIQUE, tg_name TEXT,
      mode TEXT NOT NULL DEFAULT 'har', paused INTEGER NOT NULL DEFAULT 0, linked_at TEXT NOT NULL, last_at TEXT);
  `);
  const u = db.prepare("INSERT INTO users (id, login, name, role, bitrix_user_id) VALUES (?,?,?,?,?)");
  const l = db.prepare("INSERT INTO coach_links (user_id, chat_id, mode, paused, linked_at) VALUES (?,?,?,?,?)");
  const T = "2026-10-01T00:00:00.000Z";
  u.run(1, "s1", "Sotuvchi", "sotuvchi", "14");      l.run(1, "1001", "har", 0, T);   // ✓
  u.run(2, "b1", "B2B", "b2b", " 155 ");             l.run(2, "1002", "kun", 0, T);   // ✓ (rejim farqi yo'q)
  u.run(3, "m1", "Menejer", "menejer", "132");       l.run(3, "1003", "har", 0, T);   // ✓
  u.run(4, "m2", "To'xtatgan", "menejer", "133");    l.run(4, "1004", "har", 1, T);   // ✗ paused=1
  u.run(5, "m3", "Bloklagan", "sotuvchi", "134");    l.run(5, "1005", "har", 2, T);   // ✗ paused=2
  u.run(6, "s2", "CRMsiz", "sotuvchi", null);        l.run(6, "1006", "har", 0, T);   // ✗ CRM ID yo'q
  u.run(7, "s3", "Bo'sh CRM", "sotuvchi", "  ");     l.run(7, "1007", "har", 0, T);   // ✗ CRM ID bo'sh
  u.run(8, "o1", "Operator", "operator", "200");     l.run(8, "1008", "har", 0, T);   // ✗ rol
  u.run(9, "r1", "Rahbar", "rahbar", "1");           l.run(9, "1009", "har", 0, T);   // ✗ rol
  u.run(10, "s4", "Ulanmagan", "sotuvchi", "15");                                     // ✗ ulanmagan
  return db;
}

test("kimga: faqat ulangan, to'xtatmagan, CRM ID li sotuvchilar", () => {
  const db = baza();
  const r = kimga(db, "2026-10-27");
  assert.deepEqual(r, [
    { user_id: 1, chat_id: "1001", owner: "14" },
    { user_id: 2, chat_id: "1002", owner: "155" },
    { user_id: 3, chat_id: "1003", owner: "132" },
  ]);
});

test("kimga: belgila() dan keyin shu kuni qayta chiqmaydi, ertasi kuni chiqadi", () => {
  const db = baza();
  belgila(db, 1, "2026-10-27");
  belgila(db, 3, "2026-10-27", "qadamsiz bitim yo‘q");
  assert.deepEqual(kimga(db, "2026-10-27").map((r) => r.user_id), [2]);
  assert.deepEqual(kimga(db, "2026-10-28").map((r) => r.user_id), [1, 2, 3]);
  belgila(db, 1, "2026-10-27", "xato: qayta");                      // takror — xatosiz almashtiradi
  const rows = db.prepare("SELECT user_id, day, note, sent_at FROM coach_morning ORDER BY user_id").all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].note, "xato: qayta");
  assert.equal(rows[1].note, "qadamsiz bitim yo‘q");
  assert.ok(!Number.isNaN(Date.parse(rows[0].sent_at)));
});

test("init idempotent; noto'g'ri sana va user_id rad etiladi", () => {
  const db = baza();
  init(db); init(db);
  db.exec("CREATE TABLE IF NOT EXISTS coach_morning (user_id INTEGER, day TEXT, sent_at TEXT, note TEXT, PRIMARY KEY(user_id, day))");
  assert.equal(kimga(db, "2026-10-27").length, 3);
  assert.throws(() => kimga(db, "27.10.2026"), /YYYY-MM-DD/);
  assert.throws(() => kimga(db, "2026-10-27' OR 1=1 --"), /YYYY-MM-DD/);
  assert.throws(() => belgila(db, "abc", "2026-10-27"), /butun son/);
  assert.throws(() => belgila(db, 1, ""), /YYYY-MM-DD/);
});

test("butun oqim: kimga → xabar (o'z bitimi) → belgila", () => {
  const db = baza();
  const sana = sanaTk(NOW);
  const rows = [bitim({ owner: "14", title: "Birinchi" }), bitim({ owner: "155", title: "Ikkinchi", amount: 7_000_000 })];
  assert.equal(vaqtmi(NOW), true);
  const chiqdi = [];
  for (const k of kimga(db, sana)) {
    const m = xabar(rows, k.owner, { now: NOW, panelUrl: "https://sotuv.example.uz" });
    belgila(db, k.user_id, sana, m ? null : "qadamsiz bitim yo‘q");
    if (m) chiqdi.push([k.chat_id, m.n, qatorlar(m.html)[0]]);
  }
  assert.deepEqual(chiqdi, [
    ["1001", 1, "• Birinchi — Taklif yuborildi, 3 kun harakatsiz"],
    ["1002", 1, "• Ikkinchi — Taklif yuborildi, 3 kun harakatsiz · <b>7 000 000 so‘m</b>"],
  ]);
  assert.equal(kimga(db, sana).length, 0);
});
