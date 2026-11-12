// node --test tests/nutq.test.mjs — akustik nutq tekshiruvi (lib/nutq.mjs).
// 12.11: faqat gudokdan iborat yozuvga (165801) Gemini 11 gapli suhbat to'qidi va 53 ball qo'yildi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { profil, asos, oynalar, ASOS_MIN } from "../lib/nutq.mjs";

// Gudok: 1 s tekis -12 dB, 4 s jimlik (-120); nutq: bo'g'inlar — har 0,1 s balandlik o'zgaradi
const gudok = (sek) => Array.from({ length: sek * 10 }, (_, i) => (i % 50 < 10 ? -12 : -120));
const nutqQator = (sek) => Array.from({ length: sek * 10 }, (_, i) => -20 - (i % 3) * 6);

test("profil: gudok — nutq yo'q, bo'g'inli tovush — nutq bor", () => {
  const g = profil(gudok(40));
  assert.equal(g.bor, false);
  assert.ok(g.modSec < 1, `gudokda tebranish ${g.modSec}s`);
  const n = profil([...gudok(10), ...nutqQator(20)]);
  assert.equal(n.bor, true);
  assert.ok(n.modSec >= 10);
});

test("asos: gaplar nutq bor joyga tushsa — asosli, gudok/jimlikka tushsa — yo'q", () => {
  const p = profil([...gudok(10), ...nutqQator(20), ...gudok(10)]);   // nutq 10–30 s
  assert.equal(asos([{ at: 12 }, { at: 20 }, { at: 28 }], p).ulush, 1);
  const tq = asos([{ at: 2 }, { at: 5 }, { at: 35 }, { at: 15 }], p);
  assert.equal(tq.asosli, 1);
  assert.ok(tq.ulush < ASOS_MIN);
});

const ffmpegBor = spawnSync("ffmpeg", ["-version"]).status === 0;
test("oynalar + profil: haqiqiy ffmpeg — 425 Hz gudok va bo'g'inli shovqin", { skip: !ffmpegBor && "ffmpeg yo'q" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nutq-"));
  try {
    const g = path.join(dir, "gudok.mp3"), n = path.join(dir, "nutq.mp3");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=425:d=30",
      "-af", "volume='if(lt(mod(t,5),1),0.5,0)':eval=frame", g]);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anoisesrc=d=30:c=pink:a=0.3",
      "-af", "lowpass=f=3000,volume='0.1+0.9*abs(sin(2*PI*2.5*t))*abs(sin(2*PI*0.7*t))':eval=frame", n]);
    const pg = profil(await oynalar(g)), pn = profil(await oynalar(n));
    assert.equal(pg.bor, false, `gudok: ${JSON.stringify({ mod: pg.modSec, r: pg.ratio })}`);
    assert.equal(pn.bor, true, `nutq: ${JSON.stringify({ mod: pn.modSec, r: pn.ratio })}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
