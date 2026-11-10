// Web'dan 7 ta agentga savol berish uchun ko'prik.
// Agentning tirik Telegram sessiyasiga tegmaydi — uning o'z profili (CLAUDE_CONFIG_DIR),
// o'z uy papkasi va o'z xotirasi bilan bir martalik `claude -p` chaqiriladi.
import { spawn } from "node:child_process";

export const AGENTS = [
  // Nom tizimi: ism + soha. Ranglar avatar to'plami bilan bir xil
  // (public/brand/agents/<id>.png — Telegram profil rasmi ham shu).
  { id: "tezkorlid",  name: "Chaqmoq — Tezkor lid",      role: "yangi lidga darhol javob beradi va menejerga uzatadi", color: "#38BDF8", ini: "CH", holat: "faol", kanal: "telegram+web" },
  { id: "mijozegasi", name: "Vafo — Mijoz saqlash",      role: "aloqa uzilgan mijozlarni topadi va qaytarish yo'lini beradi", color: "#16A36A", ini: "VA", holat: "faol", kanal: "telegram+web" },
  { id: "sotuvcoach", name: "Murabbiy — Sotuv sifati",   role: "menejerlar suhbat sifatini kuzatadi va tavsiya beradi", color: "#F59E0B", ini: "MU", holat: "faol", kanal: "telegram+web" },
  { id: "marketing",  name: "Manba — Marketing tahlili", role: "qaysi kanal haqiqiy pul keltirayotganini o'lchaydi",   color: "#7FB2F7", ini: "MA", holat: "nafaqada", kanal: "yo'q",
    izoh: "Boti mijozlar uchun @Sun_manba_bot sotuvchi chatbotiga o'tkazildi (2026-09-19)" },
  { id: "auditchi",   name: "Nazorat — Loyiha ijrosi",   role: "montaj va ijro loyihalarining bosqichlari va muddatlari", color: "#B8C2CF", ini: "NA", holat: "faol", kanal: "telegram+web" },
  { id: "moliya",     name: "Hisob — Moliya",            role: "to'lov bosqichidagi bitimlar va tushum hisoboti",       color: "#0B4FB0", ini: "HI", holat: "faol", kanal: "telegram+web" },
  { id: "sotuv",      name: "Sarvar — Sotuv boshqaruvi", role: "bo'lim bo'yicha reja, fakt, forecast va hisobot",       color: "#1677FF", ini: "SA", holat: "faol", kanal: "telegram+web" },
  { id: "qongiroq",   name: "Ovoz — Qo'ng'iroq tahlili", role: "telefon suhbatlarini dalil bilan tahlil qiladi",        color: "#0E9AA7", ini: "OV", holat: "faol", kanal: "telegram+web" },
  // Yagona sotuvga aloqasi yo'q agent: uning sohasi panelning O'Z himoyasi.
  // Telegram boti yo'q — faqat web ko'prigi orqali javob beradi, shuning uchun
  // shared/agents.json (tmux/systemd ro'yxati) ga ataylab qo'shilmagan.
  { id: "qoriqchi",   name: "Qalqon — Xavfsizlik",       role: "panel va serverning himoyasini o'lchaydi, dalil bilan tushuntiradi", color: "#DC2626", ini: "QA", holat: "cheklangan", kanal: "faqat web",
    izoh: "Telegram boti yo'q — faqat panel orqali javob beradi" },
];

export const isAgent = (id) => AGENTS.some((a) => a.id === id);

// TZI F08: agent sonlari YAGONA katalogdan olinadi — menyu, kampus va hisobotda
// har xil raqam chiqmasligi uchun. Hech qayerda qo'lda son yozilmaydi.
export const agentSummary = () => ({
  jami: AGENTS.length,
  faol: AGENTS.filter((a) => a.holat === "faol").length,
  cheklangan: AGENTS.filter((a) => a.holat === "cheklangan").length,
  nafaqada: AGENTS.filter((a) => a.holat === "nafaqada").length,
});

const BASE = process.env.AI_AGENT_HOME || "/home/claude";
const CLAUDE_BIN = process.env.CLAUDE_BIN || "/usr/bin/claude";
const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS || 180000);
const MAX_CONCURRENT = 2;

let running = 0;
const queue = [];

function slot() {
  if (running < MAX_CONCURRENT) { running++; return Promise.resolve(); }
  return new Promise((r) => queue.push(r));
}
function release() {
  running--;
  const next = queue.shift();
  if (next) { running++; next(); }
}

export function queueDepth() { return { running, waiting: queue.length }; }

// Veb-chat (`/api/agents/:id/ask`) — faqat savol-javob kanali, hech qachon yozmaydi.
// Shuning uchun `bypassPermissions` o'rniga OQ RO'YXAT: standart holat — taqiq, `-p`
// rejimida ro'yxatda yo'q vosita o'zi rad etiladi. Qora ro'yxat bu yerda yaramaydi —
// u faqat bilgan vositadan saqlaydi, ertaga qo'shilganini o'tkazib yuboradi.
// Muhim: `Bash` butunlay olib tashlanmaydi — agent raqamlarni o'qish skriptlari bilan
// oladi; ruxsat faqat shu skriptlarga, qobiqqa emas.
const OQIYDIGAN_VOSITALAR = [
  "Read", "Grep", "Glob",
  "Bash(/home/claude/scripts/agents/bitrix-deals.sh:*)",
  "Bash(/home/claude/scripts/agents/bitrix-leads.sh:*)",
  "Bash(/home/claude/scripts/agents/bitrix-calls.sh:*)",
  "Bash(/home/claude/scripts/agents/bitrix-clients.sh:*)",
  "Bash(/home/claude/scripts/agents/bitrix-query.sh:*)",
  "Bash(/home/claude/scripts/agents/bitrix-healthcheck.sh:*)",
  "Bash(/home/claude/scripts/agents/qongiroq-tahlil.sh:*)",
  "Bash(/home/claude/scripts/agents/sotuv-kpi.sh:*)",
  "mcp__odoo__odoo_search_read", "mcp__odoo__odoo_search_count",
  "mcp__odoo__odoo_read_group", "mcp__odoo__odoo_read",
  "mcp__odoo__odoo_search", "mcp__odoo__odoo_name_search",
  "mcp__odoo__odoo_fields_get", "mcp__odoo__odoo_list_models",
  "mcp__odoo__odoo_describe_model", "mcp__odoo__odoo_user_context",
  "mcp__odoo__odoo_list_metrics", "mcp__odoo__odoo_glossary",
  "mcp__odoo__odoo_menu_tree",
].join(",");

export async function ask(agentId, question) {
  if (!isAgent(agentId)) throw new Error("Noma'lum agent");
  const q = String(question || "").trim();
  if (!q) throw new Error("Savol bo'sh");
  if (q.length > 6000) throw new Error("Savol juda uzun");

  await slot();
  const started = Date.now();
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(CLAUDE_BIN, ["-p", q, "--model", "haiku", "--allowedTools", OQIYDIGAN_VOSITALAR], {
        cwd: `${BASE}/agents/${agentId}`,
        env: {
          ...process.env,
          HOME: BASE,
          CLAUDE_CONFIG_DIR: `${BASE}/.claude-${agentId}`,
          PATH: `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${BASE}/.bun/bin`,
          AI_AGENT_HOME: BASE,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "", err = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Agent javob bermadi (vaqt tugadi)")); }, TIMEOUT_MS);
      child.stdout.on("data", (d) => { out += d; if (out.length > 200000) child.kill("SIGKILL"); });
      child.stderr.on("data", (d) => { err += d; });
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        const text = out.trim();
        // `claude -p` autentifikatsiya xatosini 0 kod bilan, oddiy matn sifatida qaytaradi —
        // uni javob deb saqlab qo'ymaslik uchun alohida ushlaymiz.
        if (/OAuth session expired|Failed to authenticate|Invalid API key|credit balance/i.test(text)) {
          return reject(new Error(
            "Agent hisobi autentifikatsiyadan o'tmadi (OAuth muddati tugagan). " +
            "Bu web'ning emas, agent profilining muammosi — credential yangilanishi kerak."));
        }
        if (code !== 0 && !text) return reject(new Error(err.trim().slice(0, 400) || `claude ${code} kodi bilan tugadi`));
        resolve({ text: text || "(bo'sh javob)", ms: Date.now() - started });
      });
    });
  } finally {
    release();
  }
}
