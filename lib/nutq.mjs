// Akustik nutq tekshiruvi (2026-11-12) — AI'siz, faqat ffmpeg.
//
// Nega: 165801 qo'ng'iroqda yozuvda faqat gudok bor edi (425 Hz, 1 s / 4 s), Gemini esa 11 gapli «suhbat» to'qib,
// operatorga 53 ball qo'ydi. Transkript uzun bo'lgani uchun «40 belgidan qisqa» tekshiruvi o'tkazib yubordi.
//
// Belgi: tirik nutq bo'g'inma-bo'g'in tebranadi — 0,1 s oynalar balandligi qo'shni oynadan >2 dB farq qiladi.
// Gudok/signal yangrab turganda balandligi tekis. O'lchangan (12.11, 4 ta yozuv):
//   gudok:   tebranuvchi 0,5–0,9 s, ulush 0,07–0,10
//   suhbat:  tebranuvchi 17,6–29,0 s, ulush 0,52–0,59
// Chegara: kamida MIN_SEC soniya tebranuvchi nutq va ulush ≥ MIN_RATIO.
import { spawn } from "node:child_process";

const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
export const WIN = 0.1;            // oyna, soniya
export const VOICED_DB = -40;      // shundan baland — tovush bor
export const MOD_DB = 2;           // qo'shni oynadan farq — bo'g'in tebranishi
export const MIN_SEC = Number(process.env.NUTQ_MIN_SEC || 3);
export const MIN_RATIO = Number(process.env.NUTQ_MIN_RATIO || 0.25);

// RMS (dBFS) har 0,1 s — nutq polosasi (200–3600 Hz), 16 kHz
export function oynalar(file, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-af",
      "aresample=16000,highpass=f=200,lowpass=f=3600,asetnsamples=n=1600:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
      "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const t = setTimeout(() => { c.kill("SIGKILL"); reject(new Error("ffmpeg: nutq tekshiruvi vaqti tugadi")); }, timeoutMs);
    c.stdout.on("data", (d) => { out += d; });
    c.stderr.on("data", (d) => { err += d; });
    c.on("error", (e) => { clearTimeout(t); reject(new Error(`ffmpeg ishga tushmadi: ${e.message}`)); });
    c.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(err.slice(-300) || `ffmpeg ${code}`));
      resolve(out.split("\n").filter((l) => l.includes("RMS_level")).map((l) => { const v = l.split("=")[1]; return v === "-inf" ? -120 : Number(v); }));
    });
  });
}

// dB qatoridan profil: har oyna tovushli/tebranuvchi, jami soniyalar va xulosa
export function profil(db) {
  const mod = db.map((v, i) => {
    if (v <= VOICED_DB || i === 0 || i === db.length - 1) return false;
    return Math.abs(v - db[i - 1]) > MOD_DB && Math.abs(db[i + 1] - v) > MOD_DB;
  });
  const voiced = db.filter((v) => v > VOICED_DB).length * WIN;
  const modSec = mod.filter(Boolean).length * WIN;
  const ratio = voiced ? modSec / voiced : 0;
  return { dur: +(db.length * WIN).toFixed(1), voiced: +voiced.toFixed(1), modSec: +modSec.toFixed(1), ratio: +ratio.toFixed(2),
    bor: modSec >= MIN_SEC && ratio >= MIN_RATIO, mod };
}

// Transkript gaplari yozuvdagi haqiqiy nutqqa tayanadimi: har gap [at-1, end+1] oralig'ida kamida bitta tebranuvchi oyna bo'lsin.
// Qaytaradi: { jami, asosli, ulush } — ulush < ASOS_MIN bo'lsa transkript to'qima deb hisoblanadi.
export function asos(segments, p) {
  const segs = (segments || []).filter((s) => Number.isFinite(s.at));
  if (!segs.length) return { jami: 0, asosli: 0, ulush: 1 };
  const bor = (from, to) => {
    for (let i = Math.max(0, Math.floor(from / WIN)); i <= Math.min(p.mod.length - 1, Math.ceil(to / WIN)); i++) if (p.mod[i]) return true;
    return false;
  };
  const asosli = segs.filter((s) => bor(s.at - 1, Math.max(s.end || s.at, s.at) + 1)).length;
  return { jami: segs.length, asosli, ulush: +(asosli / segs.length).toFixed(2) };
}
export const ASOS_MIN = 2 / 3;
