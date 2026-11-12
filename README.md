# Pitaka Sales

Pitaka sotuv bo'limi uchun panel va **qo'ng'iroq sifati agenti**. Bitrix24 (`crm.smartworld.uz`) dan
**faqat o'qiydi**: lidlar, bitimlar, qo'ng'iroqlar va ularning yozuvlari. CRM'ga hech narsa yozilmaydi.

## Nima qiladi

- **Voronka** — liddan to'lovgacha 7 bosqich, har bosqichda nechta lid, qayerda va nima sababdan yo'qolgani.
- **Qo'ng'iroq tahlili** — har bir qo'ng'iroq yozuvi matnga o'giriladi, operator Pitaka ssenariysi bo'yicha
  baholanadi, lid kvalifikatsiyasi (KVAL / NE KVAL) suhbatga mosligi tekshiriladi.
- **Nazorat** — buzilishlar va kechikkan lidlar xodim kesimida panelda; Telegram'da **Murabbiy** bot
  operatorga o'z qo'ng'iroqlari bo'yicha ball, maslahat va vazifa yuboradi.

## Ma'lumot oqimi

```
Bitrix24 (faqat o'qish: *.list, *.get)
  ├─ crm.lead / crm.deal / crm.status  → voronka, lidlar, bitimlar, SLA
  └─ crm.activity (TYPE_ID=2, qo'ng'iroq) → FILES[0] → disk.file.get → DOWNLOAD_URL (mp3)
        → Gemini: transkript (o'zbek / rus) → spiker rollari matn mazmuni bo'yicha qayta aniqlanadi
        → qoida qatlami (lib/callai.mjs, lib/calldict.mjs): 8 mezon, 100 ball, iqtibos bilan
        → Gemini tahlili (lib/callllm.mjs): xulosa, e'tirozlar, kval / nekval, yo'qotish sababi,
          o'tkazib yuborilgan ssenariy bosqichlari — transkriptda yo'q iqtibos tashlab yuboriladi
        → SQLite (data/sotuv.db) → panel (public/index.html) va Murabbiy bot
```

Telefoniya (`telephony` / `voximplant.*`) ruxsati kerak emas — yozuvlar Disk orqali olinadi.

## Voronka bosqichlari (lib/voronka.mjs)

| # | Bosqich | Qoida |
|---|---|---|
| 1 | Yangi lid | davrda yaratilgan lid |
| 2 | Bog'lanildi | 10 soniyadan uzun qo'ng'iroq bor yoki lid Kvalifikatsiya / NE KVAL holatida |
| 3 | Kvalifikatsiya | lid «Kvalifikatsiya» holatida yoki bitimga aylangan |
| 4 | Bitim ochildi | lid bitimga aylantirilgan (CONVERTED) |
| 5 | Ma'lumot berildi | «Sotuv Bo'limi» bitimi shu yoki keyingi bosqichda |
| 6 | Hisob berildi | bitim shu yoki keyingi bosqichda |
| 7 | To'lov | «100% to'lov» yoki «Muvaffaqiyatli» |

Yo'qotish: lid `JUNK` / `UC_O11I30` (NE KVAL) / `UC_7YH6KA` (Arxiv), bitim `LOSE`. Sabab — CRM'dagi
«Rad etish sababi» maydonlari (lid `UF_CRM_1776932197903`, bitim `UF_CRM_1776938212406`).

## Qo'ng'iroq bahosi

8 mezon (`RUBRIC`, lib/callai.mjs): salomlashish va tanishtirish, kvalifikatsiya (telefon modeli, ehtiyoj),
ochiq savollar, tinglash, Pitaka qiymati (Aramid, kafolat, rasmiy diler, 10 kunda qaytarish), e'tirozlar,
keyingi qadam, kelishuvni tasdiqlash. Ssenariy — mijozning ProAudit «oltin ssenariylari»:
`data/pitaka-scenarios.json` (mijoz materiali, **repoga tushmaydi**, `data/` git'dan chiqarilgan) va
uning telefon qismi `tools/sotuv-skript.md` (panel «Skript» oynasi va Murabbiy shu fayldan oladi).

## Nazorat hisobotlari (lib/nazorat.mjs)

- `GET /api/nazorat/kval` — **CRM vs suhbat**: lidning Bitrix holati (Kvalifikatsiya/Bitim → kval, NE KVAL → nekval,
  Bekor/Arxiv → rad) qo'ng'iroq suhbatidan chiqqan AI bahosi bilan solishtiriladi (avval qo'ng'iroq tahlilidagi
  iqtibosli `kval`, bo'lmasa lid sifati). **A** — CRM'da NE KVAL/bekor, suhbatda kval (yaxshi lid yo'qotilgan);
  **B** — CRM'da kval, suhbatda sifatsiz. Menejerlar kesimi va iqtibosli ro'yxat.
- `GET /api/nazorat/menejerlar` — har menejer bo'yicha: tahlil qilingan qo'ng'iroqlar, o'rtacha ball, 8 mezon
  (o'rtacha % va necha qo'ng'iroqda 50% dan past), eng zaif 3 mezon, o'tkazib yuborilgan ssenariy bosqichlari,
  suhbatdagi yo'qotish sabablari, eng yomon 5 qo'ng'iroq.
- Ikkalasi: `?days=` yoki `?from=&to=`, rahbar uchun `?menejer=<Bitrix ID>`; sotuvchi/operator faqat o'zini ko'radi.
  AI chaqirilmaydi, Bitrix faqat o'qiladi. Qo'ng'iroq Bitrix'dagi RESPONSIBLE_ID ga yoziladi — u gapirgan operator
  emas, lid egasi bo'lishi mumkin (ochiq savol).

## Nima bilan qurilgan

Node.js 24, tashqi paketsiz (`node:http`, `node:sqlite`, `node:crypto`). Build va `node_modules` yo'q.

| Fayl | Nima |
|---|---|
| `server.mjs` | HTTP server, router, sessiya, statik fayllar, foydalanuvchi buyruqlari |
| `lib/bitrix.mjs` | Bitrix24 REST klienti; o'qish metodlaridan boshqasini rad etadi |
| `lib/telephony.mjs` | Qo'ng'iroq yozuvi: Disk orqali (zaxira — telefoniya API) |
| `lib/voronka.mjs` | Voronka, yo'qotish sabablari, qotib qolganlar, qayta ishlash ro'yxati |
| `lib/calls.mjs`, `lib/sla.mjs` | Qo'ng'iroqlar reyestri, javob tezligi |
| `lib/pipeline.mjs` | Konveyer: qo'ng'iroq → audio → transkript → tahlil |
| `lib/stt.mjs`, `lib/gemini.mjs` | Gemini orqali transkript, limitlar va navbat |
| `lib/callai.mjs`, `lib/calldict.mjs` | Qoida qatlami, iboralar lug'ati, 8 mezon |
| `lib/callllm.mjs`, `lib/callrun.mjs` | AI tahlili va natijani yig'ish |
| `lib/sifat.mjs` | Lid sifati (sifatli / sifatsiz / noaniq) qo'ng'iroqlar bo'yicha |
| `lib/murabbiy*.mjs`, `lib/menyu.mjs`, `lib/ertalab.mjs` | Telegram Murabbiy bot |
| `lib/auth.mjs`, `lib/totp.mjs`, `lib/roles.mjs`, `lib/qoriqchi.mjs` | Kirish, MFA, rollar, xavfsizlik nazorati |
| `tools/call-worker.mjs` | Yangi qo'ng'iroqlarni topib tahlil qiladigan ishchi (cron) |
| `tools/mock-bitrix.mjs` | Demo Bitrix (soxta ma'lumot) — sinov uchun |
| `public/index.html` | Butun frontend (bitta fayl) |

## Sozlash (.env)

`.env` repoga tushmaydi. Namuna — `.env.example`.

| O'zgaruvchi | Nima |
|---|---|
| `BITRIX_WEBHOOK_URL` | Kiruvchi vebxuk (huquqlar: crm, disk, user) |
| `BITRIX_PORTAL` | `https://crm.smartworld.uz` — panel havolalari uchun |
| `GEMINI_API_KEY` | Transkript va tahlil |
| `STT_ENGINE` | `gemini` |
| `BITRIX_WRITES_LOCKED` | `1` — yozish yopiq |
| `PORT` | standart 8090 |
| `MURABBIY_BOT_TOKEN` | Murabbiy bot tokeni (ixtiyoriy) |

**Yozish qulfi.** `Bitrix.call` faqat o'qish metodlarini (`*.list`, `*.get`, `*.fields`, `app.info` …)
yuboradi; boshqasi tarmoqqa chiqmasdan xato beradi. Ochish — faqat `BITRIX_ALLOW_WRITES=1` bilan, ataylab.

## Lokal ishga tushirish

Talab: Node.js 24+, `ffmpeg` (qo'ng'iroq audiosi uchun). `npm install` kerak emas.

```bash
git clone https://github.com/Ai-deparments/Pitaka-sales.git && cd Pitaka-sales
cp .env.example .env                  # BITRIX_WEBHOOK_URL va GEMINI_API_KEY ni yozing
node server.mjs adduser <login> "<Ism>" <rol> [parol] [bitrix_user_id]
node server.mjs                       # http://127.0.0.1:8090
node tools/call-worker.mjs --limit 5  # yangi qo'ng'iroqlarni tahlil qilish (bir sikl)
```

Rollar: `ceo`, `direktor`, `rahbar`, `ega`, `admin`, `sotuvchi`, `menejer`, `operator`, `auditor`, `moliya`.
Sotuvchi va operator hisobini Bitrix'dagi xodimga bog'lash: `node server.mjs link <login> <bitrix_id>`.
Boshqa buyruqlar: `users`, `passwd`, `rename`, `role`, `mfaoff`, `deluser`, `help`.

Demo ma'lumot bilan (haqiqiy Bitrix'siz):

```bash
node tools/mock-bitrix.mjs --seed 42 --port 8099
BITRIX_WEBHOOK_URL=http://127.0.0.1:8099/rest/1/demo/ node server.mjs
```

## Testlar

```bash
node --test tests/*.test.mjs
```

## Xavfsizlik

- Parollar scrypt bilan, sessiyalar HttpOnly cookie'da; rahbar rollari uchun TOTP (MFA).
- Sotuvchi va operator faqat o'ziga biriktirilgan lid va qo'ng'iroqlarni ko'radi (`lib/roles.mjs`).
- `.env`, `data/` (baza, ssenariylar, Gemini holati), loglar git'ga tushmaydi.
