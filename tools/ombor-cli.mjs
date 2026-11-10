#!/usr/bin/env node
// tezkor-ombor CLI — agent (ombor/ta'minot) yoki hook uchun: «ombor-tezkor.sh "<savol>"».
// Chiqish: 0 — javob (stdout, agent o'zgartirmasdan beradi); 2 — tezkor emas / ma'lumot yo'q → odatdagi yo'l.
// FAQAT o'qish. `odoo-mcp.mjs` ni ijrochi yozadi: export async function odoo(tool, args) — agentning
// Odoo MCP kalitidan bitta chaqiruv, xato bo'lsa throw.
import { javob } from "./tezkor-ombor.mjs";
import { ctxYasa } from "./ombor-ctx.mjs";
import { odoo } from "./odoo-mcp.mjs";

const savol = process.argv.slice(2).join(" ").trim();
if (!savol) { console.error('Foydalanish: ombor-tezkor.sh "<savol>"'); process.exit(1); }
try {
  const r = await javob(savol, ctxYasa(odoo));
  if (!r) process.exit(2);
  console.log(r.text);
  process.exit(0);
} catch (e) {
  console.error(`tezkor-ombor: ${e.message}`);
  process.exit(2);
}
