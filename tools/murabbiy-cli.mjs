#!/usr/bin/env node
// Murabbiy CLI — sotuv rahbari (Sarvar) uchun: kechikkan lidlar sababini so'rash, javoblar, vazifa holati.
// Faqat panel BAZASIGA yozadi (so'rov qatorlari); Telegram'ga tegmaydi — savollarni panel jarayoni (sorovTick) yuboradi.
//   murabbiy-cli.mjs sorov kechikkan [soat=4]   — kechikkan lidlar bo'yicha so'rov yaratish (soat — javob muddati)
//   murabbiy-cli.mjs natija [id]                — so'rov natijasi (standart: oxirgisi)
//   murabbiy-cli.mjs holat [kun=7]              — operatorlar bo'yicha vazifa statistikasi
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const APP = process.env.SOTUV_APP || "/home/claude/projects/sotuv-web";
for (const f of ["/home/claude/secrets/bitrix-sotuv.env", path.join(APP, ".env")]) {
  if (!fs.existsSync(f)) continue;
  for (const l of fs.readFileSync(f, "utf8").split("\n")) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const S = await import(`${APP}/lib/murabbiy-sorov.mjs`);
const [kom, ...arg] = process.argv.slice(2);
const db = new DatabaseSync(process.env.SOTUV_DB || path.join(APP, "data", "sotuv.db"));
db.exec("PRAGMA busy_timeout=5000");
S.init(db);

try {
  if (kom === "sorov" && arg[0] === "kechikkan") {
    const soat = arg[1] == null ? 4 : Number(arg[1]);
    if (!(soat > 0 && soat <= 72)) throw new Error("soat 0 dan katta, 72 dan kichik son bo'lsin");
    const { Bitrix } = await import(`${APP}/lib/bitrix.mjs`);
    const sla = await import(`${APP}/lib/sla.mjs`);
    const rng = await import(`${APP}/lib/range.mjs`);
    const bx = new Bitrix(process.env.BITRIX_WEBHOOK_URL, { timeoutMs: 60000 });
    const q = await sla.slaCheck(bx, null, rng.rolling(30));
    console.log(S.kechikkan(db, { rows: q.atRisk || [], soat, by: "murabbiy-cli" }));
  } else if (kom === "natija") {
    console.log(S.natijaMatn(db, arg[0] ?? null));
  } else if (kom === "holat") {
    console.log(S.holatMatn(db, arg[0] == null ? 7 : Number(arg[0])));
  } else {
    console.log("Ishlatish: murabbiy-cli.mjs sorov kechikkan [soat=4] | natija [id] | holat [kun=7]");
    process.exit(kom ? 2 : 0);
  }
  process.exit(0);
} catch (e) {
  console.log(`XATO: ${e.message}`);
  process.exit(1);
}
