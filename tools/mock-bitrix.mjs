#!/usr/bin/env node
// tools/mock-bitrix.mjs — Bitrix24 REST dialektida gapiradigan demo CRM (ARXITEKTURA §5, §9.1, §9.3).
// Tashqi paketsiz, node >= 22. Web panel, agent skriptlari va konveyer bir qator o'zgarmasdan ishlaydi:
//   BITRIX_WEBHOOK_URL=http://127.0.0.1:8099/rest/1/demo/
//
// Ishga tushirish:
//   node tools/mock-bitrix.mjs --seed 42 --port 8099 [--persist data/mock-bitrix.json] [--profile pitaka]
//        [--no-user-scope] [--no-telephony] [--audio-dir tools/demo-audio] [--latency 0] [--flaky 0] [--dump]
//
// Qo'shimcha (Bitrix'da yo'q, faqat demo uchun):
//   GET /healthz                → {ok:true}
//   GET /demo/stats?days=30     → generator raqamlari (qabul tekshiruvi §12 #3 uchun)
//   GET /rec/<callId>.mp3       → CALL_RECORD_URL (Range qo'llab-quvvatlanadi)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function opt(name, def) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) return true;
  return v;
}
if (opt('help', false)) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).join('\n'));
  process.exit(0);
}
const CFG = {
  seed: Number(opt('seed', 42)),
  port: Number(opt('port', 8099)),
  host: String(opt('host', '127.0.0.1')),
  persist: opt('persist', '') ? String(opt('persist', '')) : '',
  profile: String(opt('profile', 'pitaka')),
  userScope: opt('no-user-scope', false) !== true,
  telephony: opt('no-telephony', false) !== true,
  audioDir: String(opt('audio-dir', path.join(__dirname, 'demo-audio'))),
  latency: Number(opt('latency', 0)),
  flaky: Number(opt('flaky', 0)),
  pageSize: 50,
  tzMin: 300, // Asia/Tashkent
};

// ---------------------------------------------------------------------------
// Deterministik tasodif
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(CFG.seed);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;
function weighted(items) { // [{w, ...}]
  const sum = items.reduce((s, x) => s + x.w, 0);
  let r = rnd() * sum;
  for (const it of items) { r -= it.w; if (r <= 0) return it; }
  return items[items.length - 1];
}
function logNormal(median, sigma) { // Box-Muller
  const u = 1 - rnd(), v = rnd();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return median * Math.exp(sigma * z);
}

// ---------------------------------------------------------------------------
// Vaqt (Toshkent, +05:00)
// ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
function iso(d) { // Date → "YYYY-MM-DDTHH:MM:SS+05:00"
  const t = new Date(d.getTime() + CFG.tzMin * 60000);
  const sign = CFG.tzMin >= 0 ? '+' : '-';
  const off = Math.abs(CFG.tzMin);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}${sign}${pad(Math.floor(off / 60))}:${pad(off % 60)}`;
}
function isoDate(d) { return iso(d).slice(0, 10); }
const DAY = 86400000;
function tkDayStart(d) { // Toshkent kunining boshi (UTC Date)
  const t = new Date(d.getTime() + CFG.tzMin * 60000);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - CFG.tzMin * 60000);
}
function atWorkHour(dayStart) { // 09:00–18:00 Toshkent
  return new Date(dayStart.getTime() + (9 * 60 + ri(0, 9 * 60 - 1)) * 60000 + ri(0, 59) * 1000);
}
function tkWeekday(d) { return new Date(d.getTime() + CFG.tzMin * 60000).getUTCDay(); } // 0=yak

// ---------------------------------------------------------------------------
// Profil (kompaniyaga xos nomlar) — kod bir xil, faqat lug'at
// ---------------------------------------------------------------------------
const PROFILES = {
  pitaka: {
    // Pitaka Bitrix24 (crm.smartworld.uz) bosqich va maydon nomlari — demo ma'lumot real portal bilan bir xil lug'atda.
    // Ismlar, telefonlar va summalar SOXTA.
    company: 'Pitaka (demo)',
    categories: [
      { ID: '0', NAME: "Sotuv Bo'limi" },
      { ID: '17', NAME: "G'amxo'rlik bo'limi" },
    ],
    catWeights: [{ w: 0.85, id: '0' }, { w: 0.15, id: '17' }],
    stages: [ // kod, nom, semantik — «Sotuv Bo'limi» voronkasi
      ['UC_40RVM8', 'Prioritet', 'P'], ['UC_JLBURS', 'Yangi mijoz', 'P'], ['UC_ZJAZUB', 'Kvalifikatsiya', 'P'],
      ['NEW', "Ma'lumot berildi", 'P'], ['UC_PZILMJ', 'Hisob berildi', 'P'], ['UC_934502', "100% to'lov", 'P'],
      ['WON', 'Muvaffaqiyatli', 'S'], ['LOSE', 'Bekor qilindi', 'F'],
    ],
    mainOnlyStages: ['UC_40RVM8', 'UC_JLBURS', 'UC_ZJAZUB'],   // qo'shimcha voronkada bo'lmaydi
    leadStatuses: [
      ['NEW', 'Prioritet', ''], ['UC_AEH2UE', 'Yangi mijoz', ''], ['UC_3D7LNB', 'Kvalifikatsiya', ''],
      ['CONVERTED', "Muvaffaqiyatli bo'ldi", 'S'], ['JUNK', 'Bekor qilindi', 'F'], ['UC_7YH6KA', 'ARXIV', 'F'], ['UC_O11I30', 'NE KVAL', 'F'],
    ],
    // Yoshiga qarab lid holati: yangilari hali ishlanmoqda, eskilari yopilgan
    leadStatus: (age, conv) => {
      if (age <= 3) return chance(0.6) ? 'UC_AEH2UE' : chance(0.5) ? 'UC_3D7LNB' : 'NEW';
      const r = rnd();
      if (r < conv) return 'CONVERTED';
      if (r < conv + 0.35) return 'JUNK';
      if (r < conv + 0.43) return 'UC_O11I30';
      if (age > 120 && chance(0.4)) return 'UC_7YH6KA';
      return chance(0.6) ? 'UC_3D7LNB' : 'UC_AEH2UE';
    },
    sources: [ // id, nom, ulush, konversiya (S)
      ['WEBFORM', 'CRM-форма', 0.85, 0.14], ['CALL', 'Звонок', 0.1, 0.18], ['UC_INSTAGRAM', 'Instagram ipitaka.uz', 0.05, 0.1],
    ],
    models: ['iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone 17', 'iPhone Air', 'iPhone 16 Pro Max', 'Samsung S25 Ultra'],
    prices: [889000, 949000, 1029000, 1100000, 1179000],
    volume: [['15011', 'Dona'], ['15012', 'Optom']],
    regions: [['15001', 'Toshkent shahar'], ['15002', 'Toshkent viloyati'], ['15003', 'Samarqand viloyati'], ['15004', "Farg'ona viloyati"], ['15005', 'Andijon viloyati']],
    leadReasons: [['15891', "Ko'tarmadi"], ['15892', 'Maqsadsiz'], ['15893', 'Xato raqam'], ['15894', 'Hozir emas'], ['15896', 'Dubl'], ['15897', 'Qimmat'], ['17045', 'Spam'], ['17054', 'Mavjud emas']],
    dealReasons: [['16101', "Ko'tarmadi"], ['16102', 'Maqsadsiz'], ['16103', 'Xato raqam'], ['16104', 'Hozir emas'], ['16106', 'Dubl'], ['16107', 'Qimmat'], ['16108', 'Spam'], ['16109', 'Mavjud emas']],
    fields: { lead: { reason: 'UF_CRM_1776932197903', region: 'UF_CRM_1776932053923', volume: 'UF_CRM_1776932137210' },
              deal: { reason: 'UF_CRM_1776938212406' } },
    dealTitle: (model, city, cat) => cat === '17' ? `${model} chexol — kafolat murojaati (${city})` : `${model} chexol — ${city}`,
    leadComments: ["Instagram arizasi, iPhone 17 Pro Max uchun", "Narxni so'radi", "Telegram'ga rasm yuborildi", "Ofisga kelib ko'rmoqchi", "Optom so'radi"],
    dealComments: ["Telegram'ga 3 ta rang yuborildi", 'Kuryer ertaga olib boradi', "Click orqali to'laydi", "Ofisga keladi, taqib ko'radi"],
    taskSubjects: ["Mijozga qayta qo'ng'iroq", "Telegram'ga rasmlar yuborish", 'Yetkazib berishni kelishish', "To'lovni eslatish", 'Kafolat murojaatini tekshirish'],
  },
};
const P = PROFILES[CFG.profile] || PROFILES.pitaka;
const enumItems = (pairs) => pairs.map(([ID, VALUE]) => ({ ID, VALUE }));
const LEAD_SEM = Object.fromEntries(P.leadStatuses.map(([id, , sem]) => [id, sem || 'P']));

const CITIES = ['Toshkent', 'Samarqand', 'Buxoro', 'Andijon', "Farg'ona", 'Namangan', 'Qashqadaryo', 'Surxondaryo', 'Xorazm', 'Navoiy', 'Jizzax', 'Sirdaryo', 'Nukus', 'Toshkent viloyati'];
const FIRST = ['Aziz', 'Bobur', 'Dilnoza', 'Farrux', 'Gulnora', 'Jasur', 'Kamola', 'Lola', 'Malika', 'Nodir', 'Otabek', 'Rustam', 'Sardor', 'Shahnoza', 'Timur', 'Umid', 'Zarina', 'Sherzod', 'Nilufar', 'Iroda'];
const LAST = ['Karimov', 'Rahimov', 'Toshmatov', 'Yusupov', 'Abdullayev', 'Ismoilov', 'Saidov', 'Nazarov', 'Mirzayev', 'Xolmatov', 'Qodirov', 'Ergashev', 'Tursunov', 'Sobirov', 'Umarov'];
const COMPANY_WORDS = ['Agro', 'Textile', 'Build', 'Logistic', 'Food', 'Trade', 'Energy', 'Pharm', 'Metal', 'Plast', 'Cement', 'Motors'];
const COMPANY_FORMS = ['MChJ', 'XK', 'QK', 'AJ'];
const USERS_SEED = [
  ['1', 'Bahodir', 'Rahimov', 'Bosh direktor'],
  ['2', 'Aziz', 'Karimov', 'Sotuv menejeri'],
  ['3', 'Dilnoza', 'Yusupova', 'Sotuv menejeri'],
  ['4', 'Farrux', 'Toshmatov', 'Sotuv menejeri'],
  ['5', 'Kamola', 'Saidova', 'Sotuv menejeri'],
  ['6', 'Otabek', 'Nazarov', 'Sotuv menejeri'],
  ['7', 'Malika', 'Ismoilova', 'Moliya'],
  ['8', 'Rustam', 'Abdullayev', 'Auditor'],
];
const MANAGERS = ['2', '3', '4', '5', '6'];

function phone() { // +998 9x xxx xx xx (E.164)
  const op = pick(['90', '91', '93', '94', '95', '97', '98', '99', '33', '88', '77', '55', '71']);
  return `+998${op}${pad(ri(100, 999))}${pad(ri(10, 99))}${pad(ri(10, 99))}`;
}
function phoneSubject(p) { // "+998941075500" → "94 107 55 00" (Bitrix telefoniya uslubi)
  const d = p.replace(/\D/g, '').slice(3);
  return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
}
function multi(type, value, id) { return [{ ID: String(id), VALUE_TYPE: 'WORK', VALUE: value, TYPE_ID: type }]; }
function money(n) { return (Math.round(n * 100) / 100).toFixed(2); }
function qtyFor(cat) { return cat === '0' && chance(0.08) ? ri(5, 30) : chance(0.15) ? 2 : 1; } // dona; ba'zan optom
function amountUZS(qty) { return qty * pick(P.prices); }

// ---------------------------------------------------------------------------
// Generator (§9.3)
// ---------------------------------------------------------------------------
function generate() {
  const now = new Date();
  const today = tkDayStart(now);
  const DB = { generatedAt: now.toISOString(), seed: CFG.seed, profile: CFG.profile, users: [], categories: [], statuses: [], leads: [], deals: [], contacts: [], companies: [], activities: [], vox: [], counters: {} };
  let mfId = 1000;

  // Foydalanuvchilar
  DB.users = USERS_SEED.map(([ID, NAME, LAST_NAME, WORK_POSITION]) => ({ ID, NAME, LAST_NAME, SECOND_NAME: '', EMAIL: `${NAME.toLowerCase()}@${P.company.toLowerCase().replace(/[^a-z]/g, '')}.uz`, ACTIVE: true, WORK_POSITION, UF_DEPARTMENT: [1], LAST_LOGIN: iso(new Date(now - ri(0, 3) * DAY)) }));

  // Lug'atlar
  DB.categories = P.categories.map((c, i) => ({ ID: c.ID, NAME: c.NAME, SORT: String((i + 1) * 10), IS_LOCKED: 'N' }));
  let sid = 1;
  for (const [STATUS_ID, NAME, SEMANTICS] of P.leadStatuses) DB.statuses.push({ ID: String(sid++), ENTITY_ID: 'STATUS', STATUS_ID, NAME, NAME_INIT: NAME, SORT: String(sid * 10), SYSTEM: STATUS_ID.startsWith('UC_') ? 'N' : 'Y', SEMANTICS });
  for (const [STATUS_ID, NAME] of P.sources) DB.statuses.push({ ID: String(sid++), ENTITY_ID: 'SOURCE', STATUS_ID, NAME, NAME_INIT: NAME, SORT: String(sid * 10), SYSTEM: STATUS_ID.startsWith('UC_') ? 'N' : 'Y', SEMANTICS: '' });
  for (const c of P.categories) {
    const ent = c.ID === '0' ? 'DEAL_STAGE' : `DEAL_STAGE_${c.ID}`;
    let sort = 10;
    for (const [code, NAME, SEM] of P.stages) {
      if (c.ID !== '0' && P.mainOnlyStages.includes(code)) continue; // qo'shimcha voronkada qisqa bosqichlar
      DB.statuses.push({ ID: String(sid++), ENTITY_ID: ent, STATUS_ID: c.ID === '0' ? code : `C${c.ID}:${code}`, NAME, NAME_INIT: NAME, SORT: String(sort), SYSTEM: code === 'NEW' || code === 'WON' || code === 'LOSE' ? 'Y' : 'N', SEMANTICS: SEM === 'P' ? '' : SEM, COLOR: SEM === 'S' ? '#7BD500' : SEM === 'F' ? '#FF5752' : '#39A8EF' });
      sort += 10;
    }
  }
  const stagesOf = (cat) => DB.statuses.filter((s) => s.ENTITY_ID === (cat === '0' ? 'DEAL_STAGE' : `DEAL_STAGE_${cat}`));
  const semOfStage = (stageId) => { const s = DB.statuses.find((x) => x.STATUS_ID === stageId && x.ENTITY_ID.startsWith('DEAL_STAGE')); return s ? (s.SEMANTICS || 'P') : 'P'; };
  DB._semOfStage = null; // hisoblanadi

  // Kontakt va kompaniyalar
  for (let i = 1; i <= 250; i++) {
    const NAME = pick(FIRST), LAST_NAME = pick(LAST);
    const created = new Date(now - ri(0, 500) * DAY);
    DB.contacts.push({ ID: String(i), NAME, LAST_NAME, SECOND_NAME: '', TYPE_ID: 'CLIENT', SOURCE_ID: pick(P.sources)[0], ASSIGNED_BY_ID: pick(MANAGERS), DATE_CREATE: iso(created), DATE_MODIFY: iso(created), PHONE: multi('PHONE', i % 40 === 0 ? DB.contacts[i - 2].PHONE[0].VALUE : phone(), mfId++), EMAIL: chance(0.4) ? multi('EMAIL', `${NAME.toLowerCase()}.${LAST_NAME.toLowerCase()}@mail.uz`, mfId++) : [], ADDRESS_CITY: pick(CITIES), COMMENTS: '' });
  }
  for (let i = 1; i <= 120; i++) {
    const created = new Date(now - ri(0, 500) * DAY);
    DB.companies.push({ ID: String(i), TITLE: `${pick(COMPANY_WORDS)} ${pick(COMPANY_WORDS)} ${pick(COMPANY_FORMS)}`, COMPANY_TYPE: 'CUSTOMER', INDUSTRY: pick(['MANUFACTURING', 'IT', 'CONSULTING', 'BUILDING', 'TRANSPORT', 'OTHER']), ASSIGNED_BY_ID: pick(MANAGERS), DATE_CREATE: iso(created), DATE_MODIFY: iso(created), PHONE: multi('PHONE', phone(), mfId++), EMAIL: chance(0.6) ? multi('EMAIL', `info@company${i}.uz`, mfId++) : [], ADDRESS_CITY: pick(CITIES), REVENUE: money(ri(1, 50) * 1e8), CURRENCY_ID: 'UZS', COMMENTS: '' });
  }

  // Lidlar: 365 kun, kuniga 0–6, haftalik mavsumiylik (~1200)
  let lid = 1;
  const convertedLeads = [];
  for (let d = 365; d >= 0; d--) {
    const dayStart = new Date(today.getTime() - d * DAY);
    const wd = tkWeekday(dayStart);
    const n = wd === 0 ? ri(0, 2) : wd === 6 ? ri(1, 3) : ri(2, 6);
    for (let k = 0; k < n; k++) {
      const created = atWorkHour(dayStart);
      if (created > now) continue;
      const src = weighted(P.sources.map(([id, name, w, conv]) => ({ w, id, conv })));
      const age = d;
      const status = P.leadStatus(age, src.conv);
      const sem = LEAD_SEM[status] || 'P';
      const NAME = pick(FIRST), LAST_NAME = pick(LAST);
      const isCompany = chance(0.3);
      const qty = qtyFor('0');
      const model = pick(P.models);
      const modify = new Date(Math.min(now.getTime(), created.getTime() + ri(0, Math.max(1, age)) * DAY));
      const lead = {
        ID: String(lid), TITLE: isCompany ? `${pick(COMPANY_WORDS)} ${pick(COMPANY_FORMS)} — optom chexol so'rovi` : `${NAME} ${LAST_NAME} — ${model} chexol`,
        NAME, LAST_NAME, SECOND_NAME: '', COMPANY_TITLE: isCompany ? `${pick(COMPANY_WORDS)} ${pick(COMPANY_WORDS)} ${pick(COMPANY_FORMS)}` : '',
        SOURCE_ID: src.id, SOURCE_DESCRIPTION: '', STATUS_ID: status, STATUS_SEMANTIC_ID: sem, STATUS_DESCRIPTION: '',
        DATE_CREATE: iso(created), DATE_MODIFY: iso(modify), DATE_CLOSED: sem === 'P' ? '' : iso(modify),
        ASSIGNED_BY_ID: chance(0.05) ? '1' : pick(MANAGERS), CREATED_BY_ID: '1', MODIFY_BY_ID: '1',
        OPPORTUNITY: chance(0.6) ? money(amountUZS(qty)) : '0.00', CURRENCY_ID: 'UZS', IS_RETURN_CUSTOMER: chance(0.08) ? 'Y' : 'N', IS_MANUAL_OPPORTUNITY: 'N',
        COMMENTS: chance(0.5) ? pick(P.leadComments) : '',
        PHONE: multi('PHONE', phone(), mfId++), EMAIL: chance(0.25) ? multi('EMAIL', `${NAME.toLowerCase()}${ri(1, 99)}@gmail.com`, mfId++) : [],
        BIRTHDATE: chance(0.2) ? `${ri(1965, 2000)}-${pad(ri(1, 12))}-${pad(ri(1, 28))}` : '',
        ADDRESS_CITY: pick(CITIES), UTM_SOURCE: src.id === 'UC_INSTAGRAM' ? 'instagram' : src.id === 'ADVERTISING' ? 'google' : '', UTM_CAMPAIGN: src.id === 'UC_INSTAGRAM' ? pick(['iphone17_aramid', 'samsung_ultra', 'magsafe_promo']) : '',
        [P.fields.lead.reason]: sem === 'F' && chance(0.92) ? pick(P.leadReasons)[0] : '',
        [P.fields.lead.region]: chance(0.15) ? pick(P.regions)[0] : '',
        [P.fields.lead.volume]: chance(0.3) ? (qty > 3 ? P.volume[1][0] : P.volume[0][0]) : '',
      };
      DB.leads.push(lead);
      if (sem === 'S') convertedLeads.push(lead);
      lid++;
    }
  }

  // Bitimlar: 300
  for (let i = 1; i <= 300; i++) {
    const cat = weighted(P.catWeights).id;
    const st = stagesOf(cat);
    const open = chance(0.4);
    const archive = open && chance(0.25); // 365+ kun harakatsiz
    const created = archive ? new Date(now - ri(400, 800) * DAY) : new Date(now - Math.floor(Math.pow(rnd(), 0.7) * 365) * DAY);
    let stage;
    if (open) stage = pick(st.filter((s) => !s.SEMANTICS));
    else stage = chance(0.62) ? st.find((s) => s.SEMANTICS === 'S') : st.find((s) => s.SEMANTICS === 'F');
    const sem = stage.SEMANTICS || 'P';
    const qty = qtyFor(cat);
    const noAmount = chance(0.2);
    const amount = noAmount ? '0.00' : money(amountUZS(qty));
    const ageDays = Math.floor((now - created) / DAY);
    const moved = archive ? new Date(created.getTime() + ri(1, 20) * DAY) : new Date(created.getTime() + ri(0, Math.max(1, Math.min(ageDays, 60))) * DAY);
    const lastAct = archive ? new Date(moved.getTime() + ri(0, 10) * DAY) : new Date(Math.min(now.getTime(), moved.getTime() + ri(0, 15) * DAY));
    const closeDate = open ? new Date(created.getTime() + ri(20, 90) * DAY) : new Date(moved);
    const withClient = !chance(0.3);
    const b2b = qty > 3;
    const leadRef = chance(0.5) && convertedLeads.length ? pick(convertedLeads) : null;
    DB.deals.push({
      ID: String(i), TITLE: P.dealTitle(pick(P.models), pick(CITIES), cat), TYPE_ID: 'SALE', CATEGORY_ID: cat, STAGE_ID: stage.STATUS_ID, STAGE_SEMANTIC_ID: sem,
      IS_NEW: 'N', IS_RECURRING: 'N', IS_RETURN_CUSTOMER: chance(0.1) ? 'Y' : 'N', IS_REPEATED_APPROACH: 'N', PROBABILITY: chance(0.1) ? String(ri(10, 90)) : null,
      OPPORTUNITY: amount, IS_MANUAL_OPPORTUNITY: 'Y', TAX_VALUE: '0.00', CURRENCY_ID: 'UZS',
      CLOSED: open ? 'N' : 'Y', OPENED: 'Y', CLOSEDATE: iso(closeDate), BEGINDATE: iso(created), DATE_CREATE: iso(created), DATE_MODIFY: iso(lastAct), MOVED_TIME: iso(moved), MOVED_BY_ID: '1', LAST_ACTIVITY_TIME: iso(lastAct), LAST_ACTIVITY_BY: pick(MANAGERS),
      ASSIGNED_BY_ID: pick(MANAGERS), CREATED_BY_ID: '1', MODIFY_BY_ID: '1',
      CONTACT_ID: withClient && !b2b ? String(ri(1, 250)) : null, COMPANY_ID: withClient && b2b ? String(ri(1, 120)) : null,
      LEAD_ID: leadRef ? leadRef.ID : null, SOURCE_ID: leadRef ? leadRef.SOURCE_ID : pick(P.sources)[0], SOURCE_DESCRIPTION: '',
      COMMENTS: sem === 'F' ? '' : chance(0.4) ? pick(P.dealComments) : '',
      [P.fields.deal.reason]: sem === 'F' && chance(0.97) ? pick(P.dealReasons)[0] : '',
      UTM_SOURCE: '',
      _QTY: qty,
    });
  }

  // Faoliyatlar: qo'ng'iroqlar 1500 (TYPE_ID=2), vazifalar 400 (TYPE_ID=3)
  let aid = 1, callN = 1;
  for (let i = 0; i < 1500; i++) {
    const r = rnd();
    let ownerType, owner;
    if (r < 0.6) { owner = pick(DB.deals); ownerType = '2'; } else if (r < 0.9) { owner = pick(DB.leads); ownerType = '1'; } else { owner = pick(DB.contacts); ownerType = '3'; }
    const dayOff = Math.floor(Math.pow(rnd(), 1.6) * 365);
    const dayStart = new Date(today.getTime() - dayOff * DAY);
    let start = atWorkHour(dayStart);
    if (start > now) start = new Date(now - ri(60, 3600) * 1000);
    const incoming = chance(0.45);
    const missed = chance(0.15);
    const dur = missed ? 0 : Math.max(10, Math.min(600, Math.round(logNormal(40, 0.9))));
    const end = new Date(start.getTime() + dur * 1000);
    const ph = (owner.PHONE && owner.PHONE[0] && owner.PHONE[0].VALUE) || phone();
    const resp = owner.ASSIGNED_BY_ID || pick(MANAGERS);
    const callId = ((n) => { let h = 0x811c9dc5 >>> 0; const str = `call-${CFG.seed}-${n}`; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return (h.toString(16).padStart(8, '0') + (Math.imul(h, 2654435761) >>> 0).toString(16).padStart(8, '0') + n.toString(16).padStart(8, '0') + (Math.imul(n + 7, 40503) >>> 0).toString(16).padStart(8, '0')).slice(0, 32); })(callN++);
    const originId = `VI_externalCall.${callId}.${Math.floor(start.getTime() / 1000)}`;
    DB.activities.push({
      ID: String(aid), OWNER_ID: owner.ID, OWNER_TYPE_ID: ownerType, TYPE_ID: '2', PROVIDER_ID: 'VOXIMPLANT_CALL', PROVIDER_TYPE_ID: 'CALL', PROVIDER_GROUP_ID: null,
      DIRECTION: incoming ? '1' : '2', SUBJECT: incoming ? `Входящий от ${phoneSubject(ph)}` : `Исходящий на ${phoneSubject(ph)}`,
      START_TIME: iso(start), END_TIME: iso(end), DEADLINE: iso(end), COMPLETED: 'Y', STATUS: '2', RESPONSIBLE_ID: resp, PRIORITY: '2', NOTIFY_TYPE: '0', NOTIFY_VALUE: '0',
      DESCRIPTION: missed ? '' : `Davomiyligi ${dur} s`, DESCRIPTION_TYPE: '1', LOCATION: '', CREATED: iso(start), LAST_UPDATED: iso(end), AUTHOR_ID: resp, EDITOR_ID: resp,
      SETTINGS: { MISSED_CALL: missed, HAS_RECORD: !missed && dur >= 10, CALL_TYPE: incoming ? 2 : 1 }, ORIGIN_ID: originId, ORIGINATOR_ID: 'VOXIMPLANT', RESULT_STATUS: '0', RESULT_STREAM: '0',
      FILES: [], COMMUNICATIONS: [{ ID: String(mfId++), TYPE: 'PHONE', VALUE: ph, ENTITY_ID: owner.ID, ENTITY_TYPE_ID: ownerType }],
    });
    DB.vox.push({ ID: String(aid), CALL_ID: callId, PORTAL_USER_ID: resp, PHONE_NUMBER: ph, PORTAL_NUMBER: '+998712000000', CALL_DURATION: String(dur), CALL_START_DATE: iso(start), CALL_TYPE: incoming ? '2' : '1', CALL_VOTE: '0', COST: '0.0000', COST_CURRENCY: 'UZS', CALL_FAILED_CODE: missed ? '486' : '200', CALL_FAILED_REASON: missed ? 'Busy' : '', CRM_ENTITY_TYPE: ownerType === '2' ? 'DEAL' : ownerType === '1' ? 'LEAD' : 'CONTACT', CRM_ENTITY_ID: owner.ID, CRM_ACTIVITY_ID: String(aid), REST_APP_ID: null, REST_APP_NAME: null, TRANSCRIPT_ID: null, TRANSCRIPT_PENDING: 'N', CALL_RECORD_URL: !missed && dur >= 10 ? `__REC__/${callId}.mp3` : '', RECORD_FILE_ID: !missed && dur >= 10 ? String(aid) : null, CALL_CATEGORY: 'external', ORIGIN_ID: originId });
    aid++;
  }
  for (let i = 0; i < 400; i++) {
    const onDeal = chance(0.7);
    const owner = onDeal ? pick(DB.deals.filter((d) => d.CLOSED === 'N')) : pick(DB.leads.filter((l) => l.STATUS_SEMANTIC_ID === 'P'));
    const created = new Date(now - ri(0, 60) * DAY);
    const overdue = chance(0.3);
    const completed = !overdue && chance(0.55);
    const deadline = overdue ? new Date(now - ri(1, 30) * DAY) : new Date(now + ri(0, 14) * DAY);
    DB.activities.push({
      ID: String(aid++), OWNER_ID: owner.ID, OWNER_TYPE_ID: onDeal ? '2' : '1', TYPE_ID: '3', PROVIDER_ID: 'CRM_TODO', PROVIDER_TYPE_ID: 'TODO', PROVIDER_GROUP_ID: null,
      DIRECTION: '0', SUBJECT: pick(P.taskSubjects), START_TIME: iso(created), END_TIME: iso(deadline), DEADLINE: iso(deadline), COMPLETED: completed ? 'Y' : 'N', STATUS: completed ? '2' : '1',
      RESPONSIBLE_ID: owner.ASSIGNED_BY_ID, PRIORITY: overdue ? '3' : '2', NOTIFY_TYPE: '0', NOTIFY_VALUE: '0', DESCRIPTION: '', DESCRIPTION_TYPE: '1', LOCATION: '', CREATED: iso(created), LAST_UPDATED: iso(created), AUTHOR_ID: '1', EDITOR_ID: '1', SETTINGS: [], ORIGIN_ID: '', ORIGINATOR_ID: '', RESULT_STATUS: '0', RESULT_STREAM: '0', FILES: [], COMMUNICATIONS: [],
    });
  }
  DB.counters = { lead: lid, deal: 301, contact: 251, company: 121, activity: aid, mf: mfId };
  return DB;
}

// ---------------------------------------------------------------------------
// Baza (xotira + ixtiyoriy persist)
// ---------------------------------------------------------------------------
let DB;
let persistTimer = null;
if (CFG.persist && fs.existsSync(CFG.persist)) {
  DB = JSON.parse(fs.readFileSync(CFG.persist, 'utf8'));
  console.log(`[mock-bitrix] ${CFG.persist} yuklandi (seed ${DB.seed}, ${DB.generatedAt})`);
} else {
  DB = generate();
  if (CFG.persist) persist(true);
}
function persist(nowFlag) {
  if (!CFG.persist) return;
  const write = () => { fs.mkdirSync(path.dirname(CFG.persist), { recursive: true }); fs.writeFileSync(CFG.persist, JSON.stringify(DB)); persistTimer = null; };
  if (nowFlag) return write();
  if (!persistTimer) persistTimer = setTimeout(write, 500);
}
const semOfStage = (stageId) => { const s = DB.statuses.find((x) => x.STATUS_ID === stageId && x.ENTITY_ID.startsWith('DEAL_STAGE')); return s ? (s.SEMANTICS || 'P') : 'P'; };

// ---------------------------------------------------------------------------
// Statistika (qabul tekshiruvi uchun)
// ---------------------------------------------------------------------------
function stats(days) {
  const now = Date.now();
  const from = days ? now - Number(days) * DAY : 0;
  const inR = (s) => Date.parse(s) >= from;
  const byKey = (arr, key) => arr.reduce((m, x) => { m[x[key] ?? 'null'] = (m[x[key] ?? 'null'] || 0) + 1; return m; }, {});
  const leads = DB.leads.filter((l) => inR(l.DATE_CREATE));
  const deals = DB.deals.filter((d) => inR(d.DATE_CREATE));
  const calls = DB.activities.filter((a) => a.TYPE_ID === '2' && inR(a.START_TIME));
  const tasks = DB.activities.filter((a) => a.TYPE_ID === '3');
  const sumBy = (arr, key) => arr.reduce((m, d) => { const k = d[key]; m[k] = (m[k] || 0) + Number(d.OPPORTUNITY || 0); return m; }, {});
  const openDeals = DB.deals.filter((d) => d.CLOSED === 'N');
  const won = DB.deals.filter((d) => d.STAGE_SEMANTIC_ID === 'S' && inR(d.CLOSEDATE));
  return {
    days: days || 'all', generatedAt: DB.generatedAt, seed: DB.seed, profile: DB.profile,
    users: DB.users.length, contacts: DB.contacts.length, companies: DB.companies.length,
    leads: { total: leads.length, bySemantic: byKey(leads, 'STATUS_SEMANTIC_ID'), byStatus: byKey(leads, 'STATUS_ID'), bySource: byKey(leads, 'SOURCE_ID'), byAssigned: byKey(leads, 'ASSIGNED_BY_ID') },
    deals: { created: deals.length, open: openDeals.length, openByCategory: byKey(openDeals, 'CATEGORY_ID'), openArchive365: openDeals.filter((d) => now - Date.parse(d.LAST_ACTIVITY_TIME) > 365 * DAY).length, openNoClient: openDeals.filter((d) => !d.CONTACT_ID && !d.COMPANY_ID).length, openNoAmount: openDeals.filter((d) => Number(d.OPPORTUNITY) === 0).length, wonInRange: won.length, wonSumByCurrency: sumBy(won, 'CURRENCY_ID'), closedTotal: DB.deals.length - openDeals.length },
    calls: { total: calls.length, missed: calls.filter((a) => a.SETTINGS && a.SETTINGS.MISSED_CALL).length, incoming: calls.filter((a) => a.DIRECTION === '1').length, withRecord: DB.vox.filter((v) => v.CALL_RECORD_URL && inR(v.CALL_START_DATE)).length },
    tasks: { total: tasks.length, open: tasks.filter((t) => t.COMPLETED === 'N').length, overdue: tasks.filter((t) => t.COMPLETED === 'N' && Date.parse(t.DEADLINE) < now).length },
  };
}
if (opt('dump', false)) { console.log(JSON.stringify(stats(0), null, 2)); process.exit(0); }

// ---------------------------------------------------------------------------
// So'rov tahlili: PHP/Bitrix uslubidagi kalitlar → ichma-ich obyekt
// ---------------------------------------------------------------------------
function setPath(obj, key, value) {
  // "filter[>=DATE_CREATE]" → ["filter", ">=DATE_CREATE"]; "select[]" → ["select", ""]
  const parts = [];
  const m = key.match(/^([^\[]+)((?:\[[^\]]*\])*)$/);
  if (!m) { obj[key] = value; return; }
  parts.push(m[1]);
  for (const seg of m[2].matchAll(/\[([^\]]*)\]/g)) parts.push(seg[1]);
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const last = i === parts.length - 1;
    if (p === '') { // massivga qo'shish
      if (!Array.isArray(cur)) { /* noto'g'ri */ }
      if (last) { cur.push(value); return; }
      const next = parts[i + 1] === '' ? [] : {};
      cur.push(next); cur = next; continue;
    }
    if (last) { cur[p] = value; return; }
    if (cur[p] === undefined || typeof cur[p] !== 'object') cur[p] = parts[i + 1] === '' ? [] : {};
    cur = cur[p];
  }
}
function parseParams(query, body, ctype) {
  const out = {};
  const feed = (pairs) => { for (const [k, v] of pairs) setPath(out, k, v); };
  if (query) feed([...new URLSearchParams(query)]);
  if (body && body.length) {
    if (/json/i.test(ctype || '')) {
      let j = {}; try { j = JSON.parse(body); } catch { }
      for (const [k, v] of Object.entries(j)) { if (/\[/.test(k)) setPath(out, k, v); else out[k] = v; }
    } else feed([...new URLSearchParams(body)]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Filter / select / order / sahifalash (§5.1)
// ---------------------------------------------------------------------------
const DATE_KEYS = /^(DATE_|.*_TIME$|.*DATE$|CREATED$|LAST_UPDATED$|DEADLINE$|BEGINDATE$|CLOSEDATE$|CALL_START_DATE$)/;
function fieldValue(row, key) {
  const v = row[key];
  if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && 'VALUE' in v[0]) return v.map((x) => x.VALUE);
  if (key === 'SETTINGS.MISSED_CALL') return row.SETTINGS && row.SETTINGS.MISSED_CALL;
  return v;
}
function normNum(x) { if (x === null || x === undefined || x === '') return NaN; const n = Number(x); return Number.isFinite(n) ? n : NaN; }
function cmpScalar(op, a, b, key) {
  if (op === '%') return String(a ?? '').toLowerCase().includes(String(b).toLowerCase());
  const isDate = DATE_KEYS.test(key) || /^\d{4}-\d{2}-\d{2}/.test(String(b));
  let x, y;
  if (isDate) { x = Date.parse(a); y = Date.parse(b); if (Number.isNaN(x) || Number.isNaN(y)) { x = String(a ?? ''); y = String(b); } }
  else { const nx = normNum(a), ny = normNum(b); if (!Number.isNaN(nx) && !Number.isNaN(ny)) { x = nx; y = ny; } else { x = String(a ?? ''); y = String(b); } }
  switch (op) {
    case '>=': return x >= y; case '<=': return x <= y; case '>': return x > y; case '<': return x < y;
    case '!': case '!=': return x !== y; default: return x === y;
  }
}
function matchFilter(row, filter) {
  if (!filter || typeof filter !== 'object') return true;
  for (const [rawKey, val] of Object.entries(filter)) {
    const m = rawKey.match(/^(>=|<=|!=|>|<|!|@|%|=)?(.+)$/);
    const op = m[1] || '=', key = m[2];
    let rv = fieldValue(row, key);
    const list = Array.isArray(val) ? val : (op === '@' ? [val] : null);
    if (list) { // massivda bormi
      const rvs = Array.isArray(rv) ? rv : [rv];
      const ok = rvs.some((x) => list.some((y) => cmpScalar('=', x, y, key)));
      if (op === '!' ? ok : !ok) return false;
      continue;
    }
    const rvs = Array.isArray(rv) ? rv : [rv];
    if (op === '=' && (val === 'Y' || val === 'N') && typeof rv === 'boolean') { if ((val === 'Y') !== rv) return false; continue; }
    if (!rvs.some((x) => cmpScalar(op, x, val, key))) return false;
  }
  return true;
}
function project(row, select) {
  const out = {};
  const sel = Array.isArray(select) ? select : select ? [select] : null;
  const keys = Object.keys(row).filter((k) => !k.startsWith('_'));
  if (!sel || !sel.length) { for (const k of keys) if (!k.startsWith('UF_') && k !== 'PHONE' && k !== 'EMAIL') out[k] = row[k]; return out; }
  const wantAll = sel.includes('*'), wantUF = sel.includes('UF_*');
  for (const k of keys) {
    if (sel.includes(k)) out[k] = row[k];
    else if (wantAll && !k.startsWith('UF_') && k !== 'PHONE' && k !== 'EMAIL') out[k] = row[k];
    else if (wantUF && k.startsWith('UF_')) out[k] = row[k];
  }
  return out;
}
function sortRows(rows, order) {
  if (!order || typeof order !== 'object') order = { ID: 'ASC' };
  const keys = Object.entries(order);
  return rows.slice().sort((a, b) => {
    for (const [k, dir] of keys) {
      const s = String(dir).toUpperCase() === 'DESC' ? -1 : 1;
      const av = a[k], bv = b[k];
      const na = normNum(av), nb = normNum(bv);
      let c;
      if (!Number.isNaN(na) && !Number.isNaN(nb)) c = na - nb;
      else if (DATE_KEYS.test(k)) c = (Date.parse(av) || 0) - (Date.parse(bv) || 0);
      else c = String(av ?? '').localeCompare(String(bv ?? ''));
      if (c) return c * s;
    }
    return 0;
  });
}
function listOf(rows, p) {
  const filtered = rows.filter((r) => matchFilter(r, p.filter || p.FILTER));
  const sorted = sortRows(filtered, p.order || p.ORDER || p.SORT);
  const start = Math.max(0, parseInt(p.start ?? p.START ?? 0, 10) || 0);
  const page = sorted.slice(start, start + CFG.pageSize).map((r) => project(r, p.select || p.SELECT));
  const res = { result: page, total: filtered.length };
  if (start + CFG.pageSize < filtered.length) res.next = start + CFG.pageSize;
  return res;
}
function getOne(rows, p) {
  const id = String(p.id ?? p.ID ?? '');
  const row = rows.find((r) => r.ID === id);
  if (!row) throw new BxError(400, '', 'Not found');
  return { result: project(row, ['*', 'UF_*', 'PHONE', 'EMAIL']) };
}
class BxError extends Error { constructor(status, code, desc) { super(desc); this.status = status; this.code = code; } }
function scopeCheck(scope) {
  const have = scopes();
  if (!have.includes(scope)) throw new BxError(403, 'insufficient_scope', 'The request requires higher privileges than provided by the webhook token');
}
function scopes() { const s = ['crm']; if (CFG.userScope) s.push('user'); if (CFG.telephony) s.push('telephony', 'call'); return s; }
function nextId(kind) { const n = DB.counters[kind]++; return String(n); }
function nowIso() { return iso(new Date()); }

// ---------------------------------------------------------------------------
// Metodlar (§5.2)
// ---------------------------------------------------------------------------
const M = {
  'app.info': () => ({ result: { ID: '1', CODE: 'mock-bitrix', VERSION: 1, STATUS: 'L', INSTALLED: true, PAYMENT_EXPIRED: 'N', DAYS: null, LANGUAGE_ID: 'ru', LICENSE: 'demo-mock', LICENSE_PREVIOUS: '', LICENSE_TYPE: 'demo', LICENSE_FAMILY: 'demo', SCOPE: scopes() } }),
  'profile': () => ({ result: { ID: '1', ADMIN: true, NAME: 'Bahodir', LAST_NAME: 'Rahimov', TIME_ZONE: 'Asia/Tashkent', TIME_ZONE_OFFSET: CFG.tzMin * 60 } }),
  'scope': () => ({ result: scopes() }),
  'crm.lead.list': (p) => listOf(DB.leads, p),
  'crm.lead.get': (p) => getOne(DB.leads, p),
  'crm.lead.fields': () => ({ result: fieldsOf(DB.leads[0], { [P.fields.lead.reason]: P.leadReasons, [P.fields.lead.region]: P.regions, [P.fields.lead.volume]: P.volume }) }),
  'crm.lead.add': (p) => addEntity('lead', DB.leads, p, { STATUS_ID: 'NEW', STATUS_SEMANTIC_ID: 'P', SOURCE_ID: 'OTHER', OPPORTUNITY: '0.00', CURRENCY_ID: 'UZS', ASSIGNED_BY_ID: '1' }),
  'crm.lead.update': (p) => updateEntity(DB.leads, p, (row, f) => { if (f.STATUS_ID) { const s = DB.statuses.find((x) => x.ENTITY_ID === 'STATUS' && x.STATUS_ID === f.STATUS_ID); row.STATUS_SEMANTIC_ID = s && s.SEMANTICS ? s.SEMANTICS : 'P'; } }),
  'crm.deal.list': (p) => listOf(DB.deals, p),
  'crm.deal.get': (p) => getOne(DB.deals, p),
  'crm.deal.fields': () => ({ result: fieldsOf(DB.deals[0], { [P.fields.deal.reason]: P.dealReasons }) }),
  'crm.deal.add': (p) => addEntity('deal', DB.deals, p, { CATEGORY_ID: '0', STAGE_ID: 'NEW', STAGE_SEMANTIC_ID: 'P', CLOSED: 'N', OPPORTUNITY: '0.00', CURRENCY_ID: 'UZS', ASSIGNED_BY_ID: '1', MOVED_TIME: nowIso(), LAST_ACTIVITY_TIME: nowIso(), PROBABILITY: null, CONTACT_ID: null, COMPANY_ID: null, LEAD_ID: null }),
  'crm.deal.update': (p) => updateEntity(DB.deals, p, (row, f) => {
    if (f.STAGE_ID && f.STAGE_ID !== row._prevStage) { row.STAGE_SEMANTIC_ID = semOfStage(f.STAGE_ID); row.MOVED_TIME = nowIso(); row.CLOSED = row.STAGE_SEMANTIC_ID === 'P' ? 'N' : 'Y'; }
    row.LAST_ACTIVITY_TIME = nowIso();
  }),
  'crm.contact.list': (p) => listOf(DB.contacts, p),
  'crm.contact.get': (p) => getOne(DB.contacts, p),
  'crm.contact.add': (p) => addEntity('contact', DB.contacts, p, { TYPE_ID: 'CLIENT', ASSIGNED_BY_ID: '1' }),
  'crm.company.list': (p) => listOf(DB.companies, p),
  'crm.company.get': (p) => getOne(DB.companies, p),
  'crm.company.add': (p) => addEntity('company', DB.companies, p, { COMPANY_TYPE: 'CUSTOMER', ASSIGNED_BY_ID: '1' }),
  'crm.activity.list': (p) => listOf(DB.activities, p),
  'crm.activity.get': (p) => getOne(DB.activities, p),
  'crm.activity.add': (p) => {
    const f = p.fields || p.FIELDS || {};
    if (!f.OWNER_ID || !f.OWNER_TYPE_ID || !f.TYPE_ID || !f.SUBJECT) throw new BxError(400, 'ERROR_ARGUMENT', 'Required fields: OWNER_ID, OWNER_TYPE_ID, TYPE_ID, SUBJECT');
    const id = nextId('activity');
    const now = nowIso();
    DB.activities.push({ ID: id, OWNER_ID: String(f.OWNER_ID), OWNER_TYPE_ID: String(f.OWNER_TYPE_ID), TYPE_ID: String(f.TYPE_ID), PROVIDER_ID: f.PROVIDER_ID || 'CRM_TODO', PROVIDER_TYPE_ID: f.PROVIDER_TYPE_ID || 'TODO', PROVIDER_GROUP_ID: null, DIRECTION: String(f.DIRECTION || '0'), SUBJECT: String(f.SUBJECT), START_TIME: f.START_TIME || now, END_TIME: f.END_TIME || f.DEADLINE || now, DEADLINE: f.DEADLINE || '', COMPLETED: f.COMPLETED === 'Y' ? 'Y' : 'N', STATUS: f.COMPLETED === 'Y' ? '2' : '1', RESPONSIBLE_ID: String(f.RESPONSIBLE_ID || '1'), PRIORITY: String(f.PRIORITY || '2'), NOTIFY_TYPE: '0', NOTIFY_VALUE: '0', DESCRIPTION: String(f.DESCRIPTION || ''), DESCRIPTION_TYPE: String(f.DESCRIPTION_TYPE || '1'), LOCATION: '', CREATED: now, LAST_UPDATED: now, AUTHOR_ID: '1', EDITOR_ID: '1', SETTINGS: f.SETTINGS || [], ORIGIN_ID: f.ORIGIN_ID || '', ORIGINATOR_ID: '', RESULT_STATUS: '0', RESULT_STREAM: '0', FILES: [], COMMUNICATIONS: [] });
    touchOwner(f.OWNER_TYPE_ID, f.OWNER_ID);
    persist();
    return { result: Number(id) };
  },
  'crm.activity.update': (p) => updateEntity(DB.activities, p, (row, f) => { if (f.COMPLETED) row.STATUS = f.COMPLETED === 'Y' ? '2' : '1'; row.LAST_UPDATED = nowIso(); }),
  'crm.duplicate.findbycomm': (p) => {
    const type = String(p.type || p.TYPE || 'PHONE').toUpperCase();
    const values = (Array.isArray(p.values) ? p.values : p.values ? [p.values] : (p.VALUES || [])).map((v) => String(v).replace(/\D/g, ''));
    const et = p.entity_type ? String(p.entity_type).toUpperCase() : null;
    const has = (row) => (row[type] || []).some((m) => values.some((v) => v && String(m.VALUE).replace(/\D/g, '').endsWith(v.slice(-9))));
    const out = {};
    if (!et || et === 'CONTACT') { const ids = DB.contacts.filter(has).map((c) => Number(c.ID)); if (ids.length) out.CONTACT = ids; }
    if (!et || et === 'COMPANY') { const ids = DB.companies.filter(has).map((c) => Number(c.ID)); if (ids.length) out.COMPANY = ids; }
    if (!et || et === 'LEAD') { const ids = DB.leads.filter(has).map((c) => Number(c.ID)); if (ids.length) out.LEAD = ids; }
    return { result: out };
  },
  'crm.dealcategory.list': () => ({ result: DB.categories.filter((c) => c.ID !== '0').map((c) => ({ ID: c.ID, NAME: c.NAME, SORT: c.SORT, IS_LOCKED: c.IS_LOCKED })) }), // 0-kategoriya qaytmaydi (§5.2)
  'crm.dealcategory.default.get': () => ({ result: { ID: 0, NAME: DB.categories[0].NAME } }),
  'crm.dealcategory.stage.list': (p) => { const id = String(p.id ?? p.ID ?? '0'); return { result: DB.statuses.filter((s) => s.ENTITY_ID === (id === '0' ? 'DEAL_STAGE' : `DEAL_STAGE_${id}`)).map((s) => ({ NAME: s.NAME, SORT: s.SORT, STATUS_ID: s.STATUS_ID })) }; },
  'crm.status.list': (p) => listOf(DB.statuses, { ...p, order: p.order || { SORT: 'ASC' } }),
  'crm.status.entity.types': () => ({ result: [...new Set(DB.statuses.map((s) => s.ENTITY_ID))].map((id) => ({ ID: id, NAME: id, SEMANTIC_INFO: id.startsWith('DEAL_STAGE') || id === 'STATUS' ? { START_FIELD: 'NEW', FINAL_SUCCESS_FIELD: 'WON', FINAL_UNSUCCESS_FIELD: 'LOSE' } : [] })) }),
  'user.get': (p) => {
    scopeCheck('user');
    let ids = p.ID ?? p.id ?? (p.filter && p.filter.ID) ?? (p.FILTER && p.FILTER.ID) ?? null;
    let rows = DB.users;
    if (ids !== null && ids !== undefined) { ids = (Array.isArray(ids) ? ids : [ids]).map(String); rows = rows.filter((u) => ids.includes(u.ID)); }
    if (p.ACTIVE !== undefined || (p.filter && p.filter.ACTIVE !== undefined)) rows = rows.filter((u) => u.ACTIVE);
    return { result: rows.slice(0, 50), total: rows.length };
  },
  'user.current': () => { scopeCheck('user'); return { result: DB.users[0] }; },
  'voximplant.statistic.get': (p) => {
    scopeCheck('telephony');
    const res = listOf(DB.vox, { ...p, order: p.order || p.SORT ? { [String(p.SORT || 'CALL_START_DATE')]: p.ORDER || 'DESC' } : { CALL_START_DATE: 'DESC' } });
    res.result = res.result.map((r) => ({ ...r, CALL_RECORD_URL: r.CALL_RECORD_URL ? r.CALL_RECORD_URL.replace('__REC__', `http://${CFG.host}:${CFG.port}/rec`) : '' }));
    return res;
  },
};
function fieldsOf(sample, enums = {}) { const out = {}; for (const k of [...new Set([...Object.keys(sample || {}), ...Object.keys(enums)])]) if (!k.startsWith('_')) out[k] = { ...(enums[k] ? { items: enumItems(enums[k]) } : {}), type: k.startsWith('DATE') ? 'datetime' : k === 'OPPORTUNITY' ? 'double' : k.startsWith('UF_') ? 'enumeration' : 'string', isRequired: false, isReadOnly: k === 'ID', isImmutable: false, isMultiple: k === 'PHONE' || k === 'EMAIL', isDynamic: false, title: k }; return out; }
function addEntity(kind, rows, p, defaults) {
  const f = p.fields || p.FIELDS || {};
  const id = nextId(kind);
  const now = nowIso();
  const row = { ID: id, ...defaults, ...f, DATE_CREATE: now, DATE_MODIFY: now, CREATED_BY_ID: '1', MODIFY_BY_ID: '1' };
  for (const k of ['PHONE', 'EMAIL']) if (Array.isArray(row[k])) row[k] = row[k].map((m) => ({ ID: String(DB.counters.mf++), VALUE_TYPE: m.VALUE_TYPE || 'WORK', VALUE: m.VALUE, TYPE_ID: k }));
  if (kind === 'deal' && row.STAGE_ID) { row.STAGE_SEMANTIC_ID = semOfStage(row.STAGE_ID); row.CLOSED = row.STAGE_SEMANTIC_ID === 'P' ? 'N' : 'Y'; if (!row.CLOSEDATE) row.CLOSEDATE = iso(new Date(Date.now() + 30 * DAY)); }
  rows.push(row);
  persist();
  return { result: Number(id) };
}
function updateEntity(rows, p, hook) {
  const id = String(p.id ?? p.ID ?? '');
  const row = rows.find((r) => r.ID === id);
  if (!row) throw new BxError(400, '', 'Not found');
  const f = p.fields || p.FIELDS || {};
  row._prevStage = row.STAGE_ID;
  for (const [k, v] of Object.entries(f)) {
    if (k === 'ID') continue;
    if ((k === 'OPPORTUNITY') && v !== '' && v !== null) row[k] = money(Number(v)); else row[k] = v === null ? null : (typeof v === 'object' ? v : String(v));
  }
  if (hook) hook(row, f);
  delete row._prevStage;
  row.DATE_MODIFY = nowIso();
  persist();
  return { result: true };
}
function touchOwner(type, id) {
  const t = String(type), i = String(id);
  const row = t === '2' ? DB.deals.find((d) => d.ID === i) : t === '1' ? DB.leads.find((d) => d.ID === i) : null;
  if (row) { row.LAST_ACTIVITY_TIME = nowIso(); row.DATE_MODIFY = nowIso(); }
}

// ---------------------------------------------------------------------------
// Audio (CALL_RECORD_URL) — demo-audio/*.mp3 yoki ffmpeg bilan yaratilgan ton
// ---------------------------------------------------------------------------
let AUDIO_FILES = [];
function loadAudio() {
  try { AUDIO_FILES = fs.readdirSync(CFG.audioDir).filter((f) => /\.(mp3|wav|ogg|m4a)$/i.test(f)).sort().map((f) => path.join(CFG.audioDir, f)); } catch { AUDIO_FILES = []; }
  if (!AUDIO_FILES.length) {
    try {
      fs.mkdirSync(CFG.audioDir, { recursive: true });
      const tone = path.join(CFG.audioDir, 'tone-demo.mp3');
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-ac', '1', '-b:a', '48k', tone], { stdio: 'ignore' });
      AUDIO_FILES = [tone];
      console.log('[mock-bitrix] demo audio topilmadi — ffmpeg bilan ton yaratildi:', tone);
    } catch { console.log('[mock-bitrix] demo audio yo\'q va ffmpeg topilmadi — /rec/* 404 beradi'); }
  } else console.log(`[mock-bitrix] demo audio: ${AUDIO_FILES.length} fayl (${CFG.audioDir})`);
}
function serveAudio(req, res, callId) {
  if (!AUDIO_FILES.length) { res.writeHead(404); return res.end('no audio'); }
  let h = 0; for (const ch of callId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const file = AUDIO_FILES[h % AUDIO_FILES.length];
  const size = fs.statSync(file).size;
  const type = /\.wav$/i.test(file) ? 'audio/wav' : /\.ogg$/i.test(file) ? 'audio/ogg' : /\.m4a$/i.test(file) ? 'audio/mp4' : 'audio/mpeg';
  const range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    end = Math.min(end, size - 1);
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'X-Mock-Bitrix': '1' });
  res.end(body);
}
function timeBlock(t0) { const t1 = Date.now(); return { start: t0 / 1000, finish: t1 / 1000, duration: (t1 - t0) / 1000, processing: (t1 - t0) / 1000, date_start: iso(new Date(t0)), date_finish: iso(new Date(t1)), operating_reset_at: Math.floor(t1 / 1000) + 600, operating: 0 }; }

const server = http.createServer((req, res) => {
  const t0 = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    const body = Buffer.concat(chunks).toString('utf8');
    try {
      if (url.pathname === '/healthz') return send(res, 200, { ok: true, seed: DB.seed, profile: DB.profile, generatedAt: DB.generatedAt, scope: scopes() });
      if (url.pathname === '/demo/stats') return send(res, 200, stats(url.searchParams.get('days')));
      if (url.pathname.startsWith('/rec/')) return serveAudio(req, res, url.pathname.slice(5).replace(/\.\w+$/, ''));
      const m = url.pathname.match(/^\/rest\/(\d+)\/([A-Za-z0-9_]+)\/([a-z0-9_.]+)(?:\.json)?$/i);
      if (!m) return send(res, 404, { error: 'ERROR_METHOD_NOT_FOUND', error_description: 'Method not found!' });
      const method = m[3].toLowerCase().replace(/\.json$/, '');
      const fn = M[method];
      if (!fn) return send(res, 404, { error: 'ERROR_METHOD_NOT_FOUND', error_description: `Method not found: ${method}` });
      if (CFG.flaky > 0 && Math.random() * 100 < CFG.flaky) return send(res, 503, { error: 'QUERY_LIMIT_EXCEEDED', error_description: 'Too many requests (flaky demo)' });
      if (CFG.latency > 0) await new Promise((r) => setTimeout(r, CFG.latency));
      const p = parseParams(url.search.slice(1), body, req.headers['content-type']);
      const out = fn(p);
      out.time = timeBlock(t0);
      console.log(`${new Date().toISOString()} ${method} start=${p.start ?? 0} total=${out.total ?? '-'} ${Date.now() - t0}ms`);
      return send(res, 200, out);
    } catch (e) {
      if (e instanceof BxError) return send(res, e.status, { error: e.code, error_description: e.message });
      console.error('[mock-bitrix] xato', e);
      return send(res, 500, { error: 'INTERNAL_SERVER_ERROR', error_description: String(e && e.message || e) });
    }
  });
});
server.listen(CFG.port, CFG.host, () => {
  loadAudio();
  const s = stats(0);
  console.log(`[mock-bitrix] http://${CFG.host}:${CFG.port}/rest/1/demo/  seed=${CFG.seed} profile=${CFG.profile} scope=${scopes().join(',')}`);
  console.log(`[mock-bitrix] users=${s.users} leads=${s.leads.total} deals=${s.deals.open}+${s.deals.closedTotal} contacts=${s.contacts} companies=${s.companies} calls=${s.calls.total} tasks=${s.tasks.total}${CFG.persist ? ' persist=' + CFG.persist : ''}`);
});
process.on('SIGTERM', () => { if (persistTimer) { clearTimeout(persistTimer); persist(true); } server.close(() => process.exit(0)); });
