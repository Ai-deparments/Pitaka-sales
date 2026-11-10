// Gemini — umumiy qatlam (2026-09-24). Qo'ng'iroq transkripsiyasi (stt.mjs) va tahlili (callllm.mjs)
// SHU yerdan foydalanadi, shuning uchun limitlar va navbat bitta joyda hisoblanadi.
//
// Egasi: «groq emas gemini», «billing'siz sozla». BEPUL TARIF qoidalari (limit LOYIHA va MODEL bo'yicha):
//   • kunlik so'rov limiti (…PerDay…) tugagan model Tinch okeani yarim tunigacha chetga olinadi
//     (Toshkent ~12:00, qishda ~13:00); minutlik (…PerMinute…) — retryDelay yoki 60 s; band (503) — 2 daqiqa;
//     shu paytda ro'yxatdagi keyingi model sinaladi — har modelning o'z kvotasi bor;
//   • so'rovlar server bo'yicha KETMA-KET, orasida kamida GEMINI_GAP_S (10) soniya;
//   • hamma model band/limitda bo'lsa — `allBusy` xatosi: chaqiruvchi navbatda qoldiradi yoki zaxiraga o'tadi.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const URL_OF = (m) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
export const MODELS = (process.env.GEMINI_MODELS || process.env.STT_GEMINI_MODELS
  || "gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-flash-latest,gemini-3.5-flash-lite,gemini-3.1-flash-lite")
  .split(",").map((x) => x.trim()).filter(Boolean);
// Matn vazifalari (qo'ng'iroq tahlili, lid sifati) — flash-lite'dan boshlanadi: bepul tarifda kuchli «flash»
// modellarning kunlik limiti kichik (~20 so'rov), u eng ko'p xato beradigan qadam — OVOZNI matnga o'girishga qolsin.
export const MATN = [...MODELS.filter((m) => /lite/.test(m)), ...MODELS.filter((m) => !/lite/.test(m))];
const GAP_MS = Number(process.env.GEMINI_GAP_S || process.env.STT_GEMINI_GAP_S || 10) * 1000;
const APP_DIR = process.env.SOTUV_APP || path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE = path.join(APP_DIR, "data", "stt-gemini-state.json");

export const on = () => !!process.env.GEMINI_API_KEY;
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return { models: {}, lastAt: 0 }; } };
const writeState = (st) => { try { fs.writeFileSync(STATE, JSON.stringify(st)); } catch {} };
export const modelFree = (m, st = readState()) => !(st.models?.[m]?.until > Date.now());
export const freeModels = () => { const st = readState(); return MODELS.filter((m) => modelFree(m, st)); };
export const state = () => { const st = readState(); return MODELS.map((m) => ({ m, free: modelFree(m, st), until: st.models?.[m]?.until || null, why: st.models?.[m]?.why || null })); };

// Tinch okeani yarim tuni (kunlik limit shu paytda yangilanadi), ms
export function nextPacificMidnight(now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const wallAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Date.UTC(+p.year, +p.month - 1, +p.day + 1, 0, 0, 0) - (wallAsUtc - now) + 2 * 60e3;
}
function markModel(model, e) {
  const st = readState(); st.models = st.models || {};
  const q = `${e.quota || ""} ${e.message || ""}`;
  let until;
  if (e.status === 429 && /PerDay/i.test(q)) until = nextPacificMidnight();
  else if (e.status === 429) until = Date.now() + Math.max(15, Number(e.retry || 60)) * 1000;
  else if (e.status === 503 || e.status === 500) until = Date.now() + 2 * 60e3;
  else if (e.status === 400 && /JSON mode/i.test(e.message)) until = Date.now() + 24 * 3600e3;   // bu model JSON bermaydi
  else if (e.status === 403 || e.status === 404) until = Date.now() + 6 * 3600e3;
  else until = Date.now() + 60e3;
  st.models[model] = { until, why: String(e.message || e).slice(0, 160), at: new Date().toISOString() };
  writeState(st);
}

async function once(model, parts, { json, schema, timeoutMs }) {
  // Server bo'yicha so'rovlar orasida tanaffus (bepul tarifning minutlik limiti uchun)
  const st = readState(); const wait = (st.lastAt || 0) + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, GAP_MS)));
  const st2 = readState(); st2.lastAt = Date.now(); writeState(st2);
  const gen = { temperature: 0 };
  if (json) { gen.responseMimeType = "application/json"; if (schema) gen.responseSchema = schema; }
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(URL_OF(model), { method: "POST", signal: ac.signal,
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: gen }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const det = j.error?.details || [];
      const quota = det.flatMap((d) => d.violations || []).map((v) => v.quotaId).join(",");
      const retry = parseInt(String(det.find((d) => d.retryDelay)?.retryDelay || "0"), 10) || 0;
      throw Object.assign(new Error(`Gemini ${model} ${r.status}: ${String(j.error?.message || "xato").slice(0, 100)}${quota ? ` [${quota}]` : ""}`), { status: r.status, quota, retry });
    }
    const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
    if (!text) throw Object.assign(new Error(`Gemini ${model}: bo'sh javob (${j.candidates?.[0]?.finishReason || "?"})`), { status: 0 });
    return { text, model, usage: j.usageMetadata || null };
  } finally { clearTimeout(t); }
}

// parts — Gemini «parts» massivi (audio inline_data va/yoki matn). Birinchi ishlagan model javobi qaytadi.
// check(text) — javobni tekshiruvchi (masalan JSON o'qish); xato bersa keyingi model sinaladi.
export async function generate(parts, { json = false, schema = null, timeoutMs = 180000, models = MODELS, check = null } = {}) {
  if (!on()) throw Object.assign(new Error("GEMINI_API_KEY yo'q"), { allBusy: true });
  const errs = [];
  for (const m of models) {
    if (!modelFree(m)) continue;                                   // limitda yoki band — keyingisi
    try {
      const out = await once(m, parts, { json, schema, timeoutMs });
      if (check) out.parsed = check(out.text);
      return { ...out, errors: errs };
    } catch (e) {
      errs.push(String(e.message || e).slice(0, 200));
      if (e.status !== undefined) markModel(m, e);                  // API xatosi — model holati yangilanadi
    }
  }
  throw Object.assign(new Error(errs.join(" | ") || "Gemini: hamma model limitda yoki band"), { allBusy: !freeModels().length, errors: errs });
}
