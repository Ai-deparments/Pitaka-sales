// AGENT KAMPUSI — agentlarning tirik holati + ularning sotuv jarayonidagi o'rni.
//
// G'oya: kampusdagi JOY tasodifiy emas. Binolar sotuv liniyasi bo'ylab chapdan
// o'ngga tizilgan: manba -> lid -> aloqa -> ijro -> pul -> qaytish. Ya'ni
// kampusga qarab jarayonni o'qish mumkin, va qaysi bosqichda agent yo'qligi,
// qayerda yuk to'planib qolgani ko'rinib turadi.
//
// Bino balandligi = shu bosqichdagi ish hajmi (haqiqiy Bitrix raqami).
// Chiroq yoniqmi = xizmat rostdan ishlayaptimi (systemd'dan o'qiladi).
import { execFile } from "node:child_process";
import { cached } from "./cache.mjs";
import * as rng from "./range.mjs";

const TTL = 20_000;

// Sotuv liniyasi. lane:"line" — jarayon ko'chasi, lane:"hq" — shtab.
export const CAMPUS = [
  { id: "marketing",  name: "Manba",          ini: "MA", color: "#eda100", lane: "line", slot: 0,
    stage: "manba",   stageName: "Manba",   job: "Lid qayerdan kelayotganini kuzatadi" },
  { id: "tezkorlid",  name: "Chaqmoq",        ini: "CH", color: "#2a78d6", lane: "line", slot: 1,
    stage: "lid",     stageName: "Lid",     job: "Yangi lidga birinchi bo'lib javob beradi" },
  { id: "sotuvcoach", name: "Murabbiy",       ini: "MU", color: "#eb6834", lane: "line", slot: 2,
    stage: "aloqa",   stageName: "Aloqa",   job: "Menejerlarni kuzatadi va yo'naltiradi" },
  { id: "auditchi",   name: "Nazorat",        ini: "NA", color: "#e87ba4", lane: "line", slot: 3,
    stage: "ijro",    stageName: "Ijro",    job: "Montaj va ijro loyihalarini kuzatadi" },
  { id: "moliya",     name: "Hisob",          ini: "HI", color: "#d03b3b", lane: "line", slot: 4,
    stage: "pul",     stageName: "Pul",     job: "To'lov va hisob-kitobni kuzatadi" },
  { id: "mijozegasi", name: "Vafo",           ini: "VA", color: "#1baf7a", lane: "line", slot: 5,
    stage: "qaytish", stageName: "Qaytish",  job: "Mijozni ushlab qoladi, servisga qaytaradi" },

  { id: "qongiroq",   name: "Ovoz",           ini: "OV", color: "#7b61ff", lane: "hq", slot: 0,
    stage: null, stageName: "Tahlil", job: "Tahlil qilingan suhbatlar bo'yicha dalil bilan javob beradi" },
  { id: "sotuv",      name: "Sarvar",         ini: "SA", color: "#1C5CAB", lane: "hq", slot: 1,
    stage: null, stageName: "Bo'lim boshi", job: "Butun bo'lim bo'yicha hisobot beradi" },
  { id: "qoriqchi",   name: "Qalqon",         ini: "QA", color: "#DC2626", lane: "hq", slot: 2,
    stage: null, stageName: "Xavfsizlik", job: "Panel va server himoyasini o'lchaydi, dalil bilan tushuntiradi" },
];

export const STAGES = ["manba", "lid", "aloqa", "ijro", "pul", "qaytish"];

// ---- systemd holati ----
const run = (cmd, args) => new Promise((res) => {
  execFile(cmd, args, { timeout: 8000 }, (e, out) => res(e && !out ? "" : String(out || "")));
});

async function services() {
  const units = CAMPUS.map((a) => `claude-${a.id}.service`);
  const out = await run("systemctl", ["show", ...units,
    "-p", "Id", "-p", "ActiveState", "-p", "SubState",
    "-p", "MemoryCurrent", "-p", "ActiveEnterTimestamp", "-p", "NRestarts"]);
  const map = {};
  for (const block of out.split(/\n\s*\n/)) {
    const kv = {};
    for (const line of block.split("\n")) {
      const i = line.indexOf("=");
      if (i > 0) kv[line.slice(0, i)] = line.slice(i + 1);
    }
    const id = String(kv.Id || "").replace(/^claude-|\.service$/g, "");
    if (!id) continue;
    const ts = Date.parse(kv.ActiveEnterTimestamp || "");
    const mem = Number(kv.MemoryCurrent);
    map[id] = {
      up: kv.ActiveState === "active" && kv.SubState === "running",
      state: kv.ActiveState || "unknown",
      memMB: Number.isFinite(mem) && mem > 0 ? Math.round(mem / 1048576) : null,
      sinceMs: Number.isFinite(ts) ? Date.now() - ts : null,
      restarts: Number(kv.NRestarts || 0),
    };
  }
  return map;
}

// ---- jarayon raqamlari (haqiqiy Bitrix) ----
async function pipeline(bx, R) {
  const F = { ">=DATE_CREATE": R.fromISO, "<=DATE_CREATE": R.toISO };
  const [leads, made, open, won, lost] = await Promise.all([
    bx.count("crm.lead.list", F).catch(() => 0),
    bx.count("crm.deal.list", F),
    bx.count("crm.deal.list", { ...F, CLOSED: "N" }),
    bx.count("crm.deal.list", { ...F, STAGE_SEMANTIC_ID: "S" }),
    bx.count("crm.deal.list", { ...F, STAGE_SEMANTIC_ID: "F" }),
  ]);
  // Pul: yutilgan bitimlar summasi
  const wonRows = await bx.listAll("crm.deal.list",
    { filter: { ...F, STAGE_SEMANTIC_ID: "S" }, select: ["ID", "OPPORTUNITY", "CONTACT_ID", "COMPANY_ID"],
      maxItems: 600 });
  const sum = wonRows.items.reduce((a, d) => a + Number(d.OPPORTUNITY || 0), 0);
  const withClient = wonRows.items.filter(
    (d) => String(d.CONTACT_ID || "0") !== "0" || String(d.COMPANY_ID || "0") !== "0").length;

  return {
    manba:   { n: leads, unit: "lid",    note: leads ? "Bitrix lidlari" : "lid yozuvi ishlatilmayapti" },
    lid:     { n: made,  unit: "bitim",  note: "davr ichida ochilgan" },
    aloqa:   { n: open,  unit: "ochiq",  note: "hali yopilmagan" },
    ijro:    { n: won,   unit: "yutilgan", note: "ijroga o'tgan" },
    pul:     { n: sum,   unit: "so'm",   money: true, note: `${won} ta yutilgan bitimdan` },
    qaytish: { n: withClient, unit: "mijozli", note: `${won} tadan mijozga bog'langani`,
               pct: won ? Math.round((withClient / won) * 100) : null },
    totals: { leads, made, open, won, lost, sum },
  };
}

export const campus = (bx, range) => {
  const R = rng.normalize(range, 30);
  return cached(`campus:${R.key}`, TTL, async () => {
    const [svc, pipe] = await Promise.all([services(), pipeline(bx, R)]);
    const line = CAMPUS.filter((a) => a.lane === "line");
    // Bino balandligi = shu bosqichdagi ish hajmi.
    // Ikki nozik joy:
    //  1) "pul" bosqichi so'mda o'lchanadi — uni boshqalar bilan bir o'lchovga
    //     qo'shib bo'lmaydi, shuning uchun balandlik uchun yutilgan bitim SONI olinadi.
    //  2) manba (1229 lid) va ijro (16) orasidagi farq 75 barobar — chiziqli
    //     o'lchovda kichiklari umuman ko'rinmay qoladi (voronka 77:1 tushadi).
    //     Logarifmik o'lchov ishlatiladi: tartib saqlanadi, kichigi ham o'qiladi.
    //     Chalg'itmasligi uchun HAR binoda haqiqiy raqam yozib qo'yiladi va
    //     voronkaning haqiqiy foizi alohida ko'rsatiladi.
    const loadOf = (a) => {
      const st = a.stage ? pipe[a.stage] : null;
      if (!st) return null;
      return st.money ? pipe.totals.won : st.n;
    };
    const max = Math.max(1, ...line.map(loadOf).filter((n) => Number.isFinite(n)));
    const agents = CAMPUS.map((a) => {
      const s = svc[a.id] || { up: false, state: "topilmadi", memMB: null, sinceMs: null, restarts: 0 };
      const st = a.stage ? pipe[a.stage] : null;
      const load = loadOf(a);
      return { ...a, ...s, load,
        height: a.lane === "hq" ? 0.5
              : Math.max(0.16, Math.min(1, Math.log1p(load ?? 0) / Math.log1p(max))),
        metric: st || null };
    });
    // Voronkaning haqiqiy tushishi — balandlik emas, foiz bilan
    const T = pipe.totals;
    const funnel = [
      { key: "manba", label: "Lid",      n: T.leads, pct: 100 },
      { key: "lid",   label: "Bitim",    n: T.made,  pct: T.leads ? +(T.made / T.leads * 100).toFixed(1) : null },
      { key: "ijro",  label: "Yutilgan", n: T.won,   pct: T.leads ? +(T.won  / T.leads * 100).toFixed(1) : null },
    ];
    const upCount = agents.filter((a) => a.up).length;
    return {
      agents, stages: STAGES, pipe, funnel, scale: "log",
      range: { from: R.from, to: R.to, days: R.days, label: R.label },
      health: { up: upCount, total: agents.length,
                gaps: line.filter((a) => !svc[a.id]?.up).map((a) => a.stageName) },
      at: new Date().toISOString(),
    };
  });
};
