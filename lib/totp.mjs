// TOTP (RFC 6238) — ikki bosqichli kirish. Tashqi paket yo'q, tashqi xizmat ham yo'q.
// Telefon ilovasi (Google/Microsoft Authenticator) va server bir xil formulani hisoblaydi.
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP = 30;        // soniya
const DIGITS = 6;
const WINDOW = 1;       // oldingi/keyingi oynaga ruxsat — soat farqi uchun

export function base32Encode(buf) {
  let bits = 0, val = 0, out = "";
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, val = 0; const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) continue;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// 20 baytlik sir — RFC 4226 tavsiyasi
export function newSecret() { return base32Encode(randomBytes(20)); }

function codeAt(secret, step) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  buf.writeUInt32BE(step >>> 0, 4);
  const h = createHmac("sha1", key).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function currentStep(at = Date.now()) { return Math.floor(at / 1000 / STEP); }

// Kodni tekshiradi. Muvaffaqiyatda qaysi qadam ekanini qaytaradi (takror ishlatishni bloklash uchun).
export function verify(secret, code, { at = Date.now(), lastStep = 0 } = {}) {
  const c = String(code || "").replace(/\D/g, "");
  if (c.length !== DIGITS) return { ok: false, step: 0 };
  const now = currentStep(at);
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const step = now + d;
    if (step <= lastStep) continue;               // eski yoki ishlatilgan kod qayta o'tmaydi
    const expect = Buffer.from(codeAt(secret, step));
    const given = Buffer.from(c);
    if (expect.length === given.length && timingSafeEqual(expect, given)) return { ok: true, step };
  }
  return { ok: false, step: 0 };
}

// Ilovaga qo'shish uchun standart havola
export function otpauthUri(secret, login, issuer = "SUN-HIGHTECH Sales OS") {
  const label = encodeURIComponent(`${issuer}:${login}`);
  const q = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP) });
  return `otpauth://totp/${label}?${q.toString()}`;
}

// Zaxira kodlar — telefon yo'qolsa. Bazada faqat hash saqlanadi.
export function newBackupCodes(n = 8) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const raw = randomBytes(5).toString("hex").toUpperCase();   // 10 belgi
    codes.push(raw.slice(0, 5) + "-" + raw.slice(5));
  }
  return codes;
}
export const hashCode = (c) => createHash("sha256").update(String(c).toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");

// Ko'rish uchun qulay ko'rinish: 4 talik guruh
export const pretty = (s) => String(s).replace(/(.{4})/g, "$1 ").trim();
