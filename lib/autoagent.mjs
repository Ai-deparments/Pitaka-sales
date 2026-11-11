// Automatic call agent: runs tools/call-worker.mjs on a schedule inside the web server, so new
// Bitrix calls are transcribed and analysed without anyone pressing a button.
// One cycle at a time (next run is scheduled only after the previous one exits).
// AGENT_AUTO=0 disables it; AGENT_INTERVAL_MIN / AGENT_LIMIT / AGENT_DAYS tune it.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKER = path.join(APP, "tools", "call-worker.mjs");
const LOG_FILE = path.join(APP, "data", "agent.log");
const CYCLE_TIMEOUT_MS = 25 * 60e3;

const state = { on: false, running: false, cycles: 0, lastStart: null, lastEnd: null, lastSummary: null, lastError: null, nextAt: null };

export const status = () => ({ ...state });

function appendLog(text) {
  try { fs.appendFileSync(LOG_FILE, text); } catch (e) { state.lastError = `log: ${e.message}`; }
}

function runCycle({ limit, days }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--no-warnings", WORKER, "--days", String(days), "--limit", String(limit), "--yangidan"],
      { cwd: APP, env: process.env, windowsHide: true });
    let out = "";
    const onData = (b) => { const s = b.toString(); out += s; appendLog(s); };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const killer = setTimeout(() => { child.kill(); state.lastError = "cycle timeout"; }, CYCLE_TIMEOUT_MS);
    child.on("error", (e) => { clearTimeout(killer); state.lastError = e.message; resolve({ code: -1, out }); });
    child.on("close", (code) => { clearTimeout(killer); resolve({ code, out }); });
  });
}

export function start({ log = console.log, onAnalysed = () => {} } = {}) {
  if (process.env.AGENT_AUTO === "0") { log("[agent] o'chirilgan (AGENT_AUTO=0)"); return; }
  const intervalMs = Math.max(1, Number(process.env.AGENT_INTERVAL_MIN || 5)) * 60e3;
  const limit = Math.max(1, Math.min(50, Number(process.env.AGENT_LIMIT || 6)));
  const days = Math.max(1, Math.min(30, Number(process.env.AGENT_DAYS || 1)));
  state.on = true;

  const tick = async () => {
    state.running = true;
    state.lastStart = new Date().toISOString();
    appendLog(`\n=== ${state.lastStart} sikl #${state.cycles + 1} ===\n`);
    const { code, out } = await runCycle({ limit, days });
    state.running = false;
    state.cycles++;
    state.lastEnd = new Date().toISOString();
    const summary = out.split("\n").reverse().find((l) => l.includes("yakun:") || l.includes("TO'XTADI")) || `exit ${code}`;
    state.lastSummary = summary.trim();
    if (code !== 0) state.lastError = `exit ${code}`;
    log(`[agent] ${state.lastSummary}`);
    if (/tayyor [1-9]|lid sifati [1-9]/.test(summary)) onAnalysed();
    state.nextAt = new Date(Date.now() + intervalMs).toISOString();
    setTimeout(tick, intervalMs).unref?.();
  };
  log(`[agent] avtomatik: har ${intervalMs / 60e3} daqiqada, ${limit} tagacha qo'ng'iroq, oxirgi ${days} kun`);
  setTimeout(tick, 20e3).unref?.();
}
