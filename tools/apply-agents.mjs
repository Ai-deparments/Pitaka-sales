#!/usr/bin/env node
// Sotuv agentlarining Telegram nomi, tavsifi va profil rasmini yangilaydi.
//   node apply-agents.mjs <avatar-papkasi> [--dry]
import fs from "node:fs";
import path from "node:path";

const DIR = process.argv[2];
const DRY = process.argv.includes("--dry");
const SEC = "/home/claude/secrets";

const AGENTS = [
  { id:"sotuv",      name:"Sarvar — Sotuv boshqaruvi",  short:"Bo'lim bo'yicha hisobot va nazorat",
    desc:"SUN-HIGHTECH sotuv bo'limining boshqaruv agenti. Reja, fakt, forecast va kunlik hisobot." },
  { id:"tezkorlid",  name:"Chaqmoq — Tezkor lid",       short:"Yangi lidga darhol javob",
    desc:"Yangi lid kelishi bilan javob beradi, saralaydi va mas'ul menejerga uzatadi." },
  { id:"mijozegasi", name:"Vafo — Mijoz saqlash",       short:"Mavjud mijozlarni ushlab qolish",
    desc:"Aloqa uzilgan mijozlarni topadi va qaytarish yo'lini taklif qiladi." },
  { id:"sotuvcoach", name:"Murabbiy — Sotuv sifati",    short:"Menejerlarga aniq maslahat",
    desc:"Menejerlarning suhbat sifatini kuzatadi va nima tuzatish kerakligini aytadi." },
  { id:"marketing",  name:"Manba — Marketing tahlili",  short:"Lid manbalari sifati",
    desc:"Qaysi kanal haqiqiy pul keltirayotganini o'lchaydi — marketing va sotuv chegarasi." },
  { id:"auditchi",   name:"Nazorat — Loyiha ijrosi",    short:"Montaj va ijro bosqichlari",
    desc:"Montaj va ijro loyihalarining bosqichlari va muddatlarini kuzatadi." },
  { id:"moliya",     name:"Hisob — Moliya",             short:"To'lov va tushum nazorati",
    desc:"To'lov bosqichidagi bitimlar, kechikkan to'lovlar va tushum hisoboti." },
  { id:"qongiroq",   name:"Ovoz — Qo'ng'iroq tahlili",  short:"Telefon suhbatlari tahlili",
    desc:"Qo'ng'iroqlarni dalil bilan tahlil qiladi: kayfiyat, sifat balli va xavf." },
  { id:"qoriqchi",   name:"Qalqon — Xavfsizlik",        short:"Panel va server himoyasi",
    desc:"Panel va serverning himoyasini o'lchaydi, dalil bilan tushuntiradi. Faqat o'qiydi." },
];

const tokenOf = (id) => {
  const f = path.join(SEC, `telegram-${id}.env`);
  if (!fs.existsSync(f)) return null;
  const m = fs.readFileSync(f, "utf8").match(/^\s*TELEGRAM_BOT_TOKEN\s*=\s*(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
};
const call = (t, m, body, isForm) =>
  fetch(`https://api.telegram.org/bot${t}/${m}`, isForm
    ? { method: "POST", body }
    : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json()).catch((e) => ({ ok: false, description: e.message }));

for (const a of AGENTS) {
  const t = tokenOf(a.id);
  if (!t) { console.log(`  ${a.id.padEnd(11)} token yo'q — o'tkazildi`); continue; }
  if (DRY) { console.log(`  ${a.id.padEnd(11)} -> ${a.name}`); continue; }

  const res = [];
  const r1 = await call(t, "setMyName", { name: a.name });
  res.push(`nom:${r1.ok ? "ok" : (r1.description || "xato").slice(0, 40)}`);
  const r2 = await call(t, "setMyShortDescription", { short_description: a.short });
  res.push(`qisqa:${r2.ok ? "ok" : "xato"}`);
  const r3 = await call(t, "setMyDescription", { description: a.desc });
  res.push(`tavsif:${r3.ok ? "ok" : "xato"}`);

  const img = path.join(DIR, `${a.id}.png`);
  if (fs.existsSync(img)) {
    const fd = new FormData();
    fd.append("photo", JSON.stringify({ type: "static", photo: "attach://p" }));
    fd.append("p", new Blob([fs.readFileSync(img)], { type: "image/png" }), `${a.id}.png`);
    const r4 = await call(t, "setMyProfilePhoto", fd, true);
    res.push(`rasm:${r4.ok ? "ok" : (r4.description || "xato").slice(0, 40)}`);
  } else res.push("rasm:fayl yo'q");

  console.log(`  ${a.id.padEnd(11)} ${a.name.padEnd(30)} ${res.join("  ")}`);
}
