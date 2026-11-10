# SUN-HIGHTECH Sales OS

**Ishlayotgan manzil:** https://sotuv.81-85-51-135.sslip.io

## O'zgartirish kiritish tartibi
```bash
cd ~/Desktop/NOVA-KIT/sotuv-web
# ... faylni tahrirlang ...
./deploy.sh                                  # VPS'ga chiqarish + restart + tekshirish
git add -A && git commit -m "nima o'zgardi"  # tarixga yozish
git push
```

`deploy.sh` o'zi: kodni yuboradi → huquqlarni tuzatadi → nginx va servisni qayta
ishga tushiradi → sahifa, healthz va servis holatini tekshiradi.

**Build qatlamlari (2026-09-12 dan):** `deploy.sh` vaqtinchalik build yig'adi:
`redesign/design/apply.py` (dizayn) → `apply-api.py` / `apply-server.py` →
**`redesign/kampus/apply-all.sh`** (Agent kampusi + lid/bitim maydonlari + TZ-mezon
patchlari AC-34/36/41/44/46). Oxirgisi ilgari faqat serverdagi `/opt/kampus`
qo'riqchisida yashab, deploydan KEYIN jonli faylni qayta patchlardi — repo esa
353 qator orqada qolgan edi. Endi hammasi repoda, build jonli bilan baytma-bayt
bir xil, serverdagi qo'riqchi 0 qadam bilan tinch chiqadi. Patch skriptlari
idempotent: `server.mjs`/`lib/*.mjs` ga to'g'ridan-to'g'ri tahrir kiritsangiz ham
ular o'z belgisini ko'rib o'tkazib yuboradi. `public/index.html` esa manba (dizayngacha)
holatida turadi — unga qo'lda kampus/skoring kodini qo'shmang, `apply.py` idempotent emas. Muammo bo'lsa
loglarni ko'rsatib, xato kodi bilan to'xtaydi (`&& git push` bajarilmaydi).
nginx konfigi buzuq bo'lsa qayta yuklamaydi — sayt uzilmaydi.

⚠️ **Hech qachon repoga tushmasin:** `.env`, `data/`, parollar, tokenlar.
`.gitignore` ularni to'sadi — yangi sir fayl qo'shsangiz, uni ham qo'shing.

---

Sotuv bo'limi uchun veb panel. Bitrix24 CRM'dan jonli o'qiydi, 7 ta AI agent bilan
web orqali gaplashish imkonini beradi.

## Nima bilan qurilgan
Node.js 24, **tashqi paketsiz** (`node:http`, `node:sqlite`, `node:crypto`).
Build qadami yo'q, `node_modules` yo'q.

## Tuzilishi
| Fayl | Nima |
|---|---|
| `server.mjs` | HTTP server, router, sessiya, statik fayllar |
| `lib/bitrix.mjs` | Bitrix24 REST klienti (webhook faqat serverda) |
| `lib/api.mjs` | Ma'lumot endpointlari — kokpit, lidlar, bitimlar, moliya… |
| `lib/cache.mjs` | TTL kesh — Bitrix'ga ortiqcha so'rov ketmasligi uchun |
| `lib/auth.mjs` | Parol (scrypt), sessiya, kirish cheklovi |
| `lib/agents.mjs` | 7 agentga ko'prik — bir martalik `claude -p`, tirik sessiyaga tegmaydi |
| `public/index.html` | Butun frontend (bitta fayl) |

## Sirlar
`.env` ixtiyoriy. Bo'lmasa `/home/claude/secrets/bitrix-sotuv.env` dan o'qiydi.
Kerakli o'zgaruvchi: `BITRIX_WEBHOOK_URL`.

## Foydalanuvchi qo'shish
```
node server.mjs adduser <login> "<Ism>" <ega|menejer> [parol]
```
Parol berilmasa — tasodifiy yaratiladi va ekranga chiqadi.

**Xodim parolni o'zi almashtiradi.** Rahbar yaratgan (yoki tiklagan) parol bilan kirgan xodimga
panel yuqorisida eslatma chiqadi; chap pastdagi **Profil** (ism/rol bloki yoki odam belgisi)
→ «Parolni o'zgartirish»: joriy parol + yangi parol (kamida 7 belgi). Boshqa qurilmalardagi
sessiyalar bekor bo'ladi, joriy qurilma kirgan holda qoladi. Bazada `users.pass_set_by`
(`admin` → eslatma chiqadi, `self` → xodim o'zi qo'ygan). Endpoint: `POST /api/me/passwd`.

Xodimlar (rahbar bo'lmagan rollar) uchun menyuda alohida **Hisob → Parolni o'zgartirish** bo'limi
bor, ikki qadamli: (1) login + joriy parol serverda tasdiqlanadi (`POST /api/me/passwd/check`,
login sessiya egasiniki bo'lishi shart, noto'g'ri parol **403** — 401 emas, chunki klient
kirgan holatdagi 401 ni "sessiya tugadi" deb tushunadi; 6 xato → 15 daqiqa qulf), (2) tasdiqdan keyingina yangi
parol so'raladi. Rahbarlarga bu bo'lim ko'rinmaydi — ular Profil oynasidan o'zgartiradi.
`ega` — hammasini ko'radi; `menejer` — Moliya va Jamoa bo'limlarisiz.

## Deploy
```
./deploy.sh
```
Keyin serverda: `systemctl enable --now sotuv-web`, certbot, nginx symlink
(deploy.sh oxirida buyruqlar chiqadi).

## Bilib qo'yish kerak
- Bitrix webhook'da **`user` scope yo'q** — menejer ismlari o'rniga ID ko'rsatiladi.
  Ismlar kerak bo'lsa, Bitrix24'da webhook huquqlariga `user` qo'shilsin.
- Bu portalda bosqich **kodlari qayta nomlangan** (masalan `C6:PREPAYMENT_INVOICE` = "Пауза"),
  shuning uchun to'lov bosqichlari faqat ko'rinadigan **nom** bo'yicha aniqlanadi.
- Bitimlarda **UZS va USD aralash** — summalar valyuta bo'yicha alohida ko'rsatiladi, qo'shilmaydi.
- Eski voronkada yillar davomida qotib qolgan yozuvlar bor — ular "arxiv" deb belgilanadi.
- Kunlar **Asia/Tashkent** bo'yicha hisoblanadi (Bitrix portali +03:00 da ishlaydi).

---

## v2.0 — TZ v3.0 bo'yicha upgrade (2026-08-29)

Dizayn tizimi **§2.2 "Calm Intelligence"** tokenlariga o'tkazildi (#F6F8FC / #6D28D9 / #2563EB,
radius 12/10/999, Manrope, tabular-nums). Sidebar 248px, mobil bottom navigation.

**Yangi modul: `lib/revenue.mjs`** — TZ §6.2 formulalari:
| Ko'rsatkich | Formula |
|---|---|
| Weighted Forecast | Σ(amount × win_probability) |
| Commit | Σ(amount) ehtimollik ≥ 70% |
| Gap | Plan − (Fakt + Commit) |
| Risk Revenue | Σ(amount × prob) risk_score ≥ 60 |
| Pipeline Coverage | ochiq pipeline / qolgan reja |
| Velocity | qualified × win rate × avg deal / avg cycle |
| Deal Health | engagement 25 + stage age 20 + stakeholder 20 + next step 20 + fit 15 |

**Muhim cheklovlar (bu portalga xos):**
- Bitrix'da `PROBABILITY` maydoni **bo'sh** — ehtimollik bosqich pozitsiyasidan hisoblanadi
  (birinchi bosqich 10% → oxirgisi 85%). UI'da "Hisoblangan" tegi bilan belgilanadi.
- 1 yildan ortiq harakatsiz bitimlar **arxiv** deb ajratiladi va forecastga kirmaydi
  (aks holda 99 ta o'lik yozuv KPI'ni buzadi).
- Valyutalar qo'shilmaydi — faqat UZS hisoblanadi, qolgani alohida ko'rsatiladi.

**Yangi endpointlar:** `/api/revenue/{command,pulse,missions,radar}`, `/api/deals/{id}`,
`/api/plan` (GET/POST), `/api/audit`.
**Yangi jadvallar:** `settings`, `forecast_snapshots` (§6.3 "What changed?"), `audit_events` (§13.1).
**Rollar (§5.2):** ega, ceo, rahbar, sotuvchi, ekspert, moliya, admin, auditor, menejer.

**AC-22 bajarilishi:** har blokda teg — `Jonli` (Bitrix), `Hisoblangan` (formula), `Keyingi faza`.
"Yo'l xaritasi" bo'limi 16 modulning holatini ochiq ko'rsatadi.

## Xavfsizlik (2026-08-29)

| Chora | Holat |
|---|---|
| Brute-force | nginx: 12 urinish/daqiqa/IP · ilova: 6 urinish/login, 20/IP → 15 daqiqa blok, **bazada** (restart bilan nolga qaytmaydi) |
| Kirish urinishlari | muvaffaqiyatli va muvaffaqiyatsizi audit jurnalida, IP bilan |
| CSP | `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'` |
| Boshqa sarlavhalar | HSTS 1 yil + includeSubDomains, X-Frame-Options DENY, nosniff, Permissions-Policy, COOP |
| Sessiya | HttpOnly + Secure + SameSite=Lax, 12 soat; `POST /api/logout-all` — barcha qurilmalardan chiqish |
| Parol | scrypt, minimum 12 belgi (CLI majburlaydi) |
| Baza fayli | `600`, papka `700` — server har ishga tushganda majburlaydi |
| Sirlar | `.env` repoda yo'q; webhook va token `/home/claude/secrets/` da `600` |
| Zaxira | kunlik 03:20, `VACUUM INTO`, 14 kun saqlanadi, `600` |
| Log | haftalik rotatsiya, 8 hafta (`/etc/logrotate.d/sotuv-web`) |

**Hali yopilmagan:** SSO/MFA yo'q (TZ §13.1 talab qiladi) — yagona omil parol.
Ofis IP'si ma'lum bo'lsa, nginx'da `allow/deny` bilan cheklash eng kuchli qo'shimcha bo'ladi.

## Ochiq tab yangi versiyani o'zi oladi (2026-09-12)

Panel bir marta yuklanadigan SPA — deploydan keyin ochiq tab eski kod bilan ishlayverardi
(foydalanuvchi "tuzatish chiqmadi" deb o'ylardi). Endi har API javobida `x-build`
sarlavhasi bor (`public/index.html` mtime+hajmi); klient uni o'zgarganini sezsa xavfsiz
paytda (oyna ochiq emas, maydonga yozilmayapti, tab ko'rinib turibdi) sahifani qayta
yuklaydi va turgan bo'limga qaytaradi; band bo'lsa «Hozir yangilash» chizig'i chiqadi.
Tekshirish: ≤30 s ichida, yoki tabga qaytilganda. Deploydan keyin faqat SHU versiyadan
oldin ochilgan tablarni qo'lda yangilash kerak.

## Tashqi kirish nazorati (nginx "satisfy any")

Tanish tarmoqdan — parolsiz. Boshqa joydan — brauzer avval qo'shimcha parol so'raydi.
Shu sababli IP o'zgarsa ham **hech qachon o'zingizni qulflab qo'ymaysiz**.

Boshqaruv: `/root/web-access.sh` (serverda, root sifatida)

| Buyruq | Nima qiladi |
|---|---|
| `web-access.sh status` | Hozirgi holat: tarmoqlar, parol bor-yo'qligi, himoya yoqilganmi |
| `web-access.sh net 213.230.78.0/24` | Tanish tarmoqlarni **qaytadan** belgilash (bir nechta yozish mumkin) |
| `web-access.sh net-add 84.54.100.5/32` | Ro'yxatga bitta manzil/tarmoq **qo'shish** |
| `web-access.sh pass` | Tashqi parolni almashtirish (yangisini o'zi yaratadi) |
| `web-access.sh pass MeningParolim123` | Parolni o'zingiz belgilash |
| `web-access.sh off` / `on` | Himoyani vaqtincha o'chirish / qayta yoqish |

Har buyruq `nginx -t` dan o'tgandan keyingina qo'llanadi — noto'g'ri konfig saytni o'chirmaydi.

## Login va parolni almashtirish

Ikkita alohida to'siq bor. Ikkalasi ham mustaqil o'zgartiriladi.

### 1. Ilova hisobi (login oynasi)
Serverda: `cd /home/claude/projects/sotuv-web && sudo -u claude node server.mjs <buyruq>`

| Buyruq | Nima qiladi |
|---|---|
| `users` | Hisoblar ro'yxati |
| `passwd xurshid` | Parolni almashtirish — yangisini o'zi yaratadi va ekranga chiqaradi |
| `passwd xurshid YangiParol123` | Parolni o'zingiz belgilash (min 12 belgi) |
| `rename xurshid boshliq` | Login nomini almashtirish |
| `role xurshid rahbar` | Rolni almashtirish |
| `adduser aziz "Aziz Karimov" sotuvchi '' 654` | Yangi xodim — oxirgi raqam **Bitrix mas'ul ID** |
| `link aziz 654` | Mavjud hisobni Bitrix mas'uliga bog'lash |
| `deluser aziz` | Hisobni o'chirish |

Parol, login yoki rol o'zgarsa — o'sha odamning **barcha ochiq sessiyalari bekor qilinadi**.
Oxirgi rahbar hisobini o'chirib bo'lmaydi (himoya).

### 2. Tashqi to'siq (begona tarmoqdan kirganda)
Serverda root sifatida: `/root/web-access.sh <buyruq>`

| Buyruq | Nima qiladi |
|---|---|
| `pass` | Parolni almashtirish — yangisini o'zi yaratadi |
| `pass YangiParol123` | Parolni o'zingiz belgilash |
| `user yangilogin` | Login nomini (va parolni) almashtirish |
| `net 213.230.78.0/24` | Tanish tarmoqlarni qaytadan belgilash |
| `net-add 84.54.100.5/32` | Bitta manzil qo'shish |
| `status` / `off` / `on` | Holat / vaqtincha o'chirish / yoqish |

## Rollar va ma'lumot chegarasi (TZ §5.2, AC-01)

| Rol | Ko'radi |
|---|---|
| `ega` · `ceo` · `rahbar` | Hammasi: Boshqaruv markazi, Moliya, Jamoa, Audit, reja |
| `sotuvchi` · `menejer` | **Faqat o'ziga biriktirilgan** lid, bitim, mijoz va missiyalar |
| `ekspert` · `moliya` · `admin` · `auditor` | Umumiy ko'rinish, rahbar bo'limlarisiz |

Sotuvchi hisobi **Bitrix mas'ul ID siga bog'lanishi shart** — aks holda hech qanday
yozuv ko'rinmaydi (ochiq qoldirishdan xavfsizroq). Filtr serverda, `ASSIGNED_BY_ID`
bo'yicha: begona bitimni to'g'ridan-to'g'ri havola bilan ham ocha olmaydi.

Faol Bitrix mas'ullarni ko'rish: rahbar sifatida kirib **Jamoa** bo'limiga qarang —
ID lar va ularning lid/bitim hajmi ko'rinadi.

## CRM tozalash paneli

Forecast noaniqligining sababi kodda emas — Bitrix'da ma'lumot to'ldirilmaganida.
`lib/hygiene.mjs` har bir faol bitimni 5 mezon bo'yicha tekshiradi:

| Mezon | Og'irlik | Nega muhim |
|---|---|---|
| Kontakt/kompaniya yo'q | 3 | Kim bilan gaplashishni bilib bo'lmaydi |
| Summa kiritilmagan | 3 | Forecast shu raqamdan hisoblanadi |
| Yopilish sanasi yo'q | 2 | Qaysi oyga tegishli ekani aniqlanmaydi |
| 30+ kun harakatsiz | 2 | Aloqa uzilgan |
| Keyingi qadam yo'q | 1 | Bitim o'z-o'zidan ilgarilamaydi |

**Ball** = bajarilgan tekshiruvlar ulushi (to'liq toza bitimlar ulushi emas) — shuning
uchun har bir tuzatishdan keyin raqam o'zgaradi va progress ko'rinadi.

**Ustuvorlik ikkiga bo'lingan:** avval *summasi bor, lekin to'liq emas* bitimlar
(ular allaqachon forecastga kirmoqda), keyin *summasi yo'qlar*.

Rahbar: umumiy ball, menejerlar kesimi, ustuvor ro'yxat.
Sotuvchi: faqat o'z ro'yxati. Har qatorda Bitrix24'ga to'g'ridan-to'g'ri havola.

Endpointlar: `/api/hygiene/overview` (rahbar), `/api/hygiene/worklist?check=<id>`.

## Qo'ng'iroqlar tahlili

Bitrix telefoniya API'si (`voximplant.*`, `telephony.*`) webhook'ga **ochiq emas** —
lekin qo'ng'iroqlar `crm.activity` ichida `TYPE_ID=2` sifatida saqlanadi (52 000+ yozuv).
`lib/calls.mjs` hammasini shundan hisoblaydi: yo'nalish, davomiylik, javobsizlik, mas'ul.

**Javob tezligi — muhim nuance.** Kiruvchi qo'ng'iroq lidni *o'zi* yaratadi, shuning uchun
u yerda "javob vaqti" har doim ~0 va ma'nosiz. Shuning uchun lidlar uch guruhga bo'linadi:

| Guruh | Nima |
|---|---|
| Kiruvchidan tug'ilgan | tezlik o'lchanmaydi |
| **Biz qo'ng'iroq qilganmiz** | **haqiqiy o'lchov shu** — median, p90, 5/15/60 daqiqa ichida |
| Umuman qo'ng'iroq yo'q | lid kelgan, bog'lanilmagan |

Tezkor Lid agenti "javob vaqti CRM'da kuzatilmayapti" degan edi — aslida hisoblanadi.

Endpoint: `/api/calls?days=7|30|90`. Sotuvchi faqat o'z qo'ng'iroqlarini ko'radi.
20 dan kam qo'ng'iroqli menejer "kam" deb belgilanadi — foizi statistik ishonchsiz.

## TZ v4.0 (Bitrix24 almashtirish) — holat

Yangi `TZ mezonlari` bo'limi AC-01…AC-50 ni §2.1 lug'ati bilan ko'rsatadi:
**PASS / FAIL / BLOCKED / NOT TESTED**. Bir qismi jonli tekshiriladi, har PASS
uchun dalil, har BLOCKED uchun sabab va **kim hal qilishi** yozilgan.

Hozirgi holat: **9 PASS · 16 FAIL · 9 BLOCKED · 16 NOT TESTED — AC tayyorlik 18%**.
TZ §24 go-live uchun ≥90 ball talab qiladi, ya'ni bu uzoq yo'lning boshi.

### API standarti (AC-27, AC-29, AC-46)
- `/api/v1/...` — eski `/api/...` ham ishlayveradi
- Har javobda `X-Correlation-ID` (so'rovdagisi qaytariladi yoki yangisi yaratiladi)
- Xatolar: `{code, message, details, trace_id}`; 5xx'da ichki tafsilot berilmaydi
- `Idempotency-Key` POST amallarida — takroriy so'rov saqlangan javobni qaytaradi
  (`idempotent-replay: true`), 24 soat TTL

### Kod bilan hal bo'lmaydigan blokerlar
| Bloker | Kim hal qiladi |
|---|---|
| WhatsApp Business API | SUN-HIGHTECH IT / Meta hisobi |
| SIP/PBX va Bitrix telefoniya API (scope: `call,crm`) | SUN-HIGHTECH IT / Bitrix admin |
| 1C / billing | Moliya / 1C admin |
| E-imzo provayderi | SUN-HIGHTECH IT / yuridik |
| OIDC/SSO + MFA | SUN-HIGHTECH IT |
| Bitrix `user` scope (ism/jamoa) | Bitrix admin |
| Bitrix'ga yozish (texnik mumkin, siyosat taqiqlaydi) | Bo'lim boshlig'i |
| Migratsiya sandbox / eksport namunalari | SUN-HIGHTECH IT / Bitrix admin |

### AC-01 — auditor kirishi
TZ §2 auditi `ERR_INVALID_AUTH_CREDENTIALS` bilan to'xtagan edi: bulut brauzeri
nginx Basic Auth oynasini ko'rsata olmaydi. Endi tushunarli 401 sahifasi chiqadi
va kirish yo'li ko'rsatiladi. To'liq PASS uchun auditor IP'sini qo'shish kerak:
`/root/web-access.sh net-add <IP>/32`

## Bitrix24'ga yozish (cheklangan, qaytariladigan)

Webhook'da yozish ruxsati **allaqachon bor** edi — cheklov siyosat edi
(agentlar `CLAUDE.md`: "owner aniq buyurmasa `.update` chaqirmang").
Egasi ruxsat bergach `lib/writes.mjs` qo'shildi.

### Rejimlar
`off` (standart) · `test` (kuniga 20 yozuv) · `on` (cheklovsiz)
`GET/POST /api/v1/writes/mode` — faqat rahbar o'zgartiradi.

### Faqat 4 maydon yoziladi
`amount` · `closeDate` · `contactId` · `companyId`
Boshqasi — bosqich, nom, mas'ul — rad etiladi. `delete` umuman yo'q.

### Har yozuv 3 qadam
1. **Oldindan ko'rish** (`dryRun:true`, standart) — "nima o'zgaradi", hech narsa yozilmaydi
2. **Saqlash** (`dryRun:false`) — Bitrix'ga yoziladi, `audit_events`'ga **oldin → keyin** tushadi
3. **Qaytarish** — `POST /api/v1/writes/{auditId}/undo` oldingi qiymatni tiklaydi

### Tekshirilgan himoyalar
| Urinish | Natija |
|---|---|
| Bosqich / nom / mas'ul o'zgartirish | rad etiladi |
| Manfiy yoki ulkan summa | rad etiladi |
| Noto'g'ri sana formati | rad etiladi |
| Mavjud bo'lmagan bitim | 404 |
| Qiymat o'zgarmagan bo'lsa | yozilmaydi |
| Sotuvchi begona bitimni | "sizga biriktirilmagan" |
| Kunlik cheklov (test) | 20 dan keyin 429 |

Jonli sinov: bitim #918 summasi 3 000 000 → 3 001 000 yozildi (Bitrix tasdiqladi),
audit yozildi, keyin qaytarildi — Bitrix'da yana 3 000 000.

## Ikki bosqichli kirish — MFA / TOTP (2026-09-02)

> **2026-09-12:** 2FA (TOTP) bo'limi paneldan olib tashlandi — Profil oynasida faqat ma'lumot va parol; Xodimlar ro'yxatida 2FA tegi yo'q; Qo‘riqchi 2FA tekshiruvini o'tkazmaydi (14 tekshiruv). Server endpointlari (`/api/mfa/*`, `mfaoff`, `mfareq`) va login oqimidagi TOTP qadami saqlangan — yoqilgan hisob bo'lsa hali ishlaydi.

Parolga qo'shimcha ikkinchi to'siq. Tashqi xizmat, SMS va provayder **kerak emas** —
telefondagi ilova (Google/Microsoft Authenticator) va server bir xil formulani hisoblaydi.

**Standart:** RFC 6238 (TOTP), HMAC-SHA1, 6 raqam, 30 soniya, ±1 oyna (soat farqi uchun).
`lib/totp.mjs` RFC 6238 Appendix B ning **5 ta rasmiy test vektoriga to'liq mos** —
o'zgartirsangiz avval shuni qayta tekshiring.

**Har foydalanuvchi o'zi yoqadi** — majburiy emas, standart holatda o'chiq.
Panel → chap pastda **«Xavfsizlik»** → «Sozlashni boshlash» → kalitni ilovaga qo'lda kiriting →
chiqqan kodni tasdiqlang. Yoqilganda **8 ta bir martalik zaxira kod** beriladi va faqat
o'shanda ko'rsatiladi (bazada faqat SHA-256 hash saqlanadi).

**Kirish oqimi:** parol to'g'ri bo'lsa va MFA yoqilgan bo'lsa, server sessiya ochmaydi —
`401 {code:"mfa_required"}` qaytaradi. Klient kod maydonini ochadi va login+parol+kod bilan
qayta yuboradi. Noto'g'ri kod ham `noteFail` ga tushadi: **6 urinishdan keyin 15 daqiqa blok**.

Himoyalangan holatlar (hammasi sinovdan o'tgan):
- kodsiz kirish → rad
- noto'g'ri kod → rad
- to'g'ri kod + noto'g'ri parol → rad (parol baribir talab qilinadi)
- **bir kodni ikki marta ishlatish → rad** (`totp_last_step` saqlanadi)
- zaxira kod → bir marta ishlaydi, keyin bekor

**Telefon yo'qolsa — serverdan tiklash:**
```
node server.mjs mfaoff <login>
```
MFA ni o'chiradi, barcha seanslarni yopadi va kirish blokini tozalaydi.
Foydalanuvchi keyin faqat parol bilan kiradi va qaytadan sozlashi kerak.
`node server.mjs users` ro'yxatida kimda yoqilgani `MFA` ustunida ko'rinadi.

Endpointlar: `/api/mfa/status` · `setup` · `enable` · `disable` · `backup`.
Barcha amal audit jurnaliga tushadi: `mfa.setup`, `mfa.enable`, `mfa.disable`,
`mfa.backup_new`, `login.mfa_ok`, `login.mfa_fail`, `mfa.reset`.

**Hali yo'q:** QR kod (kalit qo'lda kiritiladi) va SSO/OIDC — SSO tashqi provayder talab qiladi.

## Ikki xato tuzatildi (2026-09-02)

**1. Server xato xabarlari ko'rinmasdi.** `fail()` `{code, message}` yuboradi, klientdagi
`api()` esa faqat `j.error` ni o'qirdi — natijada har xato "Server xatosi 400" bo'lib chiqardi.
Endi `j.message || j.error` o'qiladi va `err.code` klientga uzatiladi (MFA oqimi shunga tayanadi).
Server tomonda ham qolgan `{error:...}` javoblar `fail()` ga o'tkazildi — endi hammasi bir shaklda.

**2. Sotuvchiga rahbar menyusi ko'rinardi.** `.navbtn{display:flex}` bo'lgani uchun
`el.hidden = true` e'tiborsiz qolardi va `data-owner` bo'limlari (Boshqaruv markazi, Moliya,
Audit, Jamoa, TZ mezonlari) sotuvchi ekranida ham turardi. Server 403 qaytargani uchun
ma'lumot chiqmasdi, lekin menyu noto'g'ri edi. `[hidden]{display:none!important}` global
qoidasi qo'shildi. Sinovdan keyin sotuvchi 8 ta bo'limni ko'radi, 5 tasi yashirin.

## Sinov muhiti — staging (2026-09-02)

> **2026-09-12 holati:** serverda staging nusxasi HOZIR YO'Q (papka, servis va nginx
> sayti o'chirilgan). `./deploy.sh staging` uni papka+servis darajasida qayta yaratadi,
> lekin nginx sayti va sertifikat quyidagi tartibda qo'lda qayta olinishi kerak.

Ikkinchi, mustaqil nusxa. Yangilanish avval shu yerda sinaladi, keyin jonli saytga chiqadi.

| | Jonli | Sinov |
|---|---|---|
| Manzil | `sotuv.81-85-51-135.sslip.io` | faqat ichki: `127.0.0.1:8092` |
| Servis | `sotuv-web` (port 8090) | `sotuv-web-staging` (port 8092) |
| Papka | `projects/sotuv-web` | `projects/sotuv-web-staging` |
| Baza | o'zining `data/sotuv.db` | **alohida** `data/sotuv.db` |
| Bitrix'ga yozish | sozlama bo'yicha | **qattiq qulflangan** |
| nginx himoyasi | bir xil (`sotuv-allow.conf`) | bir xil |

**Deploy:**
```
./deploy.sh staging     # avval shu yerga
./deploy.sh live        # sinovdan o'tgach
```
Argumentsiz `./deploy.sh` — jonli saytga (eski xatti-harakat saqlangan).

**Yozish qulfi.** Baza alohida bo'lsa ham **Bitrix bitta va jonli**. Shuning uchun
`sotuv-web-staging.service` da `BITRIX_WRITES_LOCKED=1`. `lib/writes.mjs` da bu qulf:
- `mode()` bazada `on` tursa ham `off` qaytaradi
- `setMode()` va `undo()` 403 bilan rad etadi

Ya'ni sinov nusxasidan jonli CRM'ga **hech qanday yo'l bilan** yozib bo'lmaydi.
Bitrix'dan **o'qish** ishlaydi — shuning uchun sinovda ham haqiqiy ma'lumot ko'rinadi.

**Adashib qolmaslik uchun.** Sinov saytida yuqorida to'q sariq chiziq turadi:
«SINOV NUSXASI — bu jonli sayt emas». Server `SOTUV_ENV=staging` ni `/api/me` javobida
qaytaradi (kirmagan holatda ham), klient shunga qarab chiziqni chizadi. Jonli saytda chiziq yo'q.

**Sinov hisobi:** `sinov` / `Sinov1234567` (faqat sinov bazasida, jonli saytga aloqasi yo'q).

**Sertifikat.** Let's Encrypt, ikki bosqichda olingan: avval faqat 80-portli vhost
(acme-challenge uchun), certbot sertifikat bergach to'liq SSL konfig qo'yildi.
Sabab: nginx `default` vhost barcha 80-port so'rovini https ga yo'naltiradi, shuning uchun
yangi domen uchun avval o'z vhost'i kerak.

**Zaxira olinmaydi** — sinov bazasi bir martalik, kerak bo'lsa o'chirib qayta yaratiladi.

---

## AI qo'ng'iroq tahlili (TZ: «AI Qo'ng'iroq tahlili»)

**Qayerda:** Sotuv → Qo'ng'iroqlar → «AI tahlil» tabi. Jadvaldagi **Tahlil** tugmasi
tahlil oynasini ochadi.

### Nima ishlaydi
| Qism | Holat |
|---|---|
| Qo'ng'iroqlar reyestri (14 ustun, 10 filtr) | jonli Bitrix24 |
| Kritik iboralar lug'ati, 4 rang, vaqt kodi bilan | ishlaydi, administrator tahrirlaydi |
| 100 ballik operator bahosi (§F), har ball dalil bilan | ishlaydi |
| Sotuv metodikasi tekshiruvi (§G) | ishlaydi |
| Kayfiyat, qiziqish, ishonch, tayyorlik (§E) | ishlaydi |
| Va'dalar va keyingi qadam (§H) | ishlaydi |
| AI xulosa/muammo/e'tiroz (§4.A–C) | `claude -p` orqali |
| Rahbar paneli, kritik lenta, «ko'rib chiqdim» (§7) | ishlaydi |
| Rol, telefon niqobi, audit (§8–§9) | ishlaydi |
| Audio yozuv | kod tayyor — webhook'da `telephony` ruxsati kutilmoqda |
| Nutqdan matnga (STT) | Groq `whisper-large-v3`, sinovdan o'tgan |
| Spikerlarni ajratish | stereo — aniq; mono — AI (sinovda 6/6) |
| TZ §12 qabul testi | `tools/acceptance-calls.mjs` tayyor |
| **Vazifani Bitrix'ga yozish** | qoralama saqlanadi; `task` ruxsati kerak |

### Transkript qayerdan keladi
**Ikki yo'l bor.**

**1) Audiodan avtomat (tayyor, ruxsat kutmoqda).** Zanjir: `voximplant.statistic.get` →
`CALL_RECORD_URL` → ffmpeg → Groq `whisper-large-v3` → transkript → tahlil.
Ishga tushishi uchun Bitrix24 webhook'ida **Телефония** katagi belgilanishi kerak; qolgan
hamma narsa sinovdan o'tgan va joyida. Panelda tugma: «Audiodan transkript olish».

Spikerlarni ajratish:
- yozuv **stereo** bo'lsa — kanal bo'yicha aniq ajratiladi (operator/mijoz);
- **mono** bo'lsa — AI kontekstdan ajratadi (sinovda 6/6 to'g'ri) va natija
  «spikerlar taxminiy» deb belgilanadi.

Sinovda topilgan muhim narsa: **Whisper'ga tilni majburlash shart.** Avtomatik aniqlashda
u o'zbekchani "Indonesian"/"Turkish" deb o'qidi va matnni buzdi, jimlikda esa uydirma
chiqardi («Altyazı M.K.»). Endi `uz` va `ru` sinaladi, ishonchi yuqorisi olinadi, uydirma
iboralar ro'yxat bo'yicha tashlanadi. Vaqt kodlari **so'z darajasida** olinadi — segment
chegarasi qo'pol edi (6-soniyalik gap "0.00" deb belgilanardi).

**2) Qo'lda kiritish (hozir ishlaydi).** Matnni tahlil oynasidagi maydonga joylang. (tahlil oynasidagi maydonga joylanadi). Bitrix24'da har bir
qo'ng'iroqda audio yozuv **bor**, lekin webhook `crm,call` doirasida bo'lgani uchun
`crm_show_file.php` faylni bermaydi (login sahifasini qaytaradi — tekshirilgan).
Telefoniya ruxsati yoqilsa, audio → STT → tahlil zanjiri avtomat bo'ladi.

Qo'llab-quvvatlanadigan format (vaqt kodi ixtiyoriy):
```
[00:00] Operator: Assalomu alaykum, SUN-HIGHTECH kompaniyasidan…
[00:06] Mijoz: Va alaykum assalom.
```
Rus tilida `Оператор:` / `Клиент:` ham tanidi. O'zbek, rus va aralash nutq sinovdan o'tgan.

### Ikki qatlamli dvigatel
1. **Qoida qatlami** (`lib/callai.mjs`) — determinstik. Kritik iboralar, savollar,
   gap bo'lish, sukut, faktlar (sana/summa/telefon/email/hujjat), 100 ballik baho,
   metodika, kayfiyat, va'dalar. **AI'siz ham to'liq ishlaydi.**
2. **AI qatlami** (`lib/callllm.mjs`) — `claude -p` bilan xulosa, muammo, ehtiyoj, e'tiroz.

**Ishonch himoyasi:** AI qaytargan har bir iqtibos transkriptda bor-yo'qligi tekshiriladi.
Topilmasa — o'sha element **tashlab yuboriladi** va oynada «Ishonch himoyasi» blokida
ko'rsatiladi. Shu sabab AI o'ylab topgan kompaniya nomi yoki e'tiroz natijaga tushmaydi
(TZ §14.5 sinovi). Ball ham AI'dan emas, dalilga asoslangan qoidadan chiqadi — AI faqat
izoh qo'shadi.

### Muhim mantiqiy ajratish
Mijozning **muammosi** (jarima, tekshiruv, qarzdorlik) va bizga qarshi **e'tirozi**
(qimmat, o'ylab ko'raman, raqobatchi) bir xil emas. Birinchisi — sotuv imkoniyati va
shoshilinchlik, ikkinchisi — bitim xavfi. Lug'atdagi `kind` maydoni shuni ajratadi.

### Fayllar
| Fayl | Nima |
|---|---|
| `lib/calldict.mjs` | Kritik so'zlar lug'ati (zavod sozlamasi) va naqshlar |
| `lib/callai.mjs` | Qoida dvigateli: transkript, dalil, ball, kayfiyat, xavf |
| `lib/callllm.mjs` | `claude -p` ko'prigi, JSON validatsiya, **grounding** |
| `lib/callrun.mjs` | Orkestrator → TZ §5 JSON, idempotency, 3 marta urinish |
| `lib/callstore.mjs` | sqlite: transkript, tahlil, lug'at, vazifa, tahrir, review |
| `lib/calls.mjs` | Reyestr, KPI (§3.1), rahbar paneli (§7) |

### Sozlamalar (ixtiyoriy)
```
CALLAI_AGENT=sotuvcoach     # qaysi agent profili ostida ishlaydi
CALLAI_DISABLED=1           # AI qatlamini o'chirish (faqat qoida)
CALLAI_TIMEOUT_MS=150000
CALLAI_CONCURRENCY=1
```

### Bilib qo'yish kerak
- **`\b` kirill bilan ishlamaydi.** JavaScript'da `\w` faqat ASCII, shuning uchun
  `/\bчто\b/` rus matnda hech qachon topilmaydi. Barcha naqsh Unicode chegarasi
  (`(?<![\p{L}\p{N}_])`) bilan qurilgan — buni buzmang.
- **Davomiylik taxminiy.** `START_TIME`–`END_TIME` farqidan olinadi; javobsizlarda bu
  jiringlash vaqti. Aniq davomiylik telefoniya ruxsatidan keladi.
- **Operator ismi yo'q** — `user` ruxsati yopiq, ID raqami ko'rsatiladi.

### TZ §12 qabul testi (30 ta real qo'ng'iroq)
```bash
node tools/acceptance-calls.mjs run --n 30 --days 30 --dry   # namunani ko'rish
node tools/acceptance-calls.mjs run --n 30 --days 30         # audiodan tahlilgacha
node tools/acceptance-calls.mjs score <toldirilgan.json>     # §12 mezonlarini hisoblash
```
Namuna operatorlar bo'yicha navbat bilan olinadi (bir kishining bir kunlik ishi emas).
`run` ikki fayl beradi: avtomat o'lchovlar (vaqt, til, uydirma to'silishi, xavf taqsimoti) va
**tekshiruv varaqasi** (HTML) — odam to'ldiradi. «85% aniqlik» va «90% kritik xavfni
o'tkazib yubormaslik» faqat shu varaqadan hisoblanadi, chunki ularni mashina o'zi baholay olmaydi.

Sozlamalar: `STT_LANGS` (standart `uz,ru`), `STT_MODEL`, `STT_TURN_GAP`.

## Xavfsizlik qo'riqchisi — «Qalqon» (2026-09-09)

Panel o'z himoyasini o'zi o'lchaydi. Sabab: himoya haqidagi bilim odamning boshida
turardi, ya'ni biror narsa buzilsa qo'lda tekshirmaguncha bilinmasdi. Ikki marta
aynan shunday bo'lgan — deploy serverdagi nginx o'zgarishini bosib ketgan, va baza
fayli 644 rejimda oylab turgan.

**Ikkita qat'iy qoida:** (1) dvigatel faqat O'QIYDI — bironta tekshiruv hech narsani
o'zgartirmaydi, tuzatish buyrug'i matn sifatida beriladi; (2) o'lchay olmasa
"muammo yo'q" demaydi, "o'lchanmadi" deydi va sababini aytadi.

| Qism | Fayl |
|---|---|
| O'lchov dvigateli (15 tekshiruv) | `lib/qoriqchi.mjs` |
| Endpoint (faqat rahbarlar, 45s kesh) | `server.mjs` → `/api/qoriqchi` |
| Panel | `public/index.html` → `v-qoriqchi` + `redesign/design/rail.html` |
| Telegram ogohlantirishi | `tools/telegram/qoriqchi-alerts.mjs` + `qoriqchi.sh` |
| Agent | `/home/claude/agents/qoriqchi/`, `lib/agents.mjs` dagi `qoriqchi` |

### Tekshiruvlar

**Kirish va hisoblar:** 2FA qamrovi · hisoblar holati (ishlatilmayotgan hisob,
hisob ustidagi amallar kim tomonidan) · ochiq sessiyalar · parol yoshi
**Hujum belgilari:** kirish urinishlari va qulflar · notanish tarmoqdan kirish ·
tashqi skanerlar (nginx jurnali)
**Server va sozlama:** nginx kirish darvozasi · TLS sertifikati muddati ·
xavfsizlik sarlavhalari · internetdan ochiq portlar
**Ma'lumot va butunlik:** fayl huquqlari · zaxira nusxa · audit jurnali ·
brend fayllari butunligi

### Ishlatish

```bash
cd /home/claude/projects/sotuv-web
node lib/qoriqchi.mjs           # qisqa hisobot (faqat muammolar)
node lib/qoriqchi.mjs --full    # hamma tekshiruv
node lib/qoriqchi.mjs --json    # mashina uchun
```

Panelda: chap menyu → **Qo'riqchi** (faqat ega/ceo/rahbar ko'radi — hisobot qaysi
hisobda 2FA yo'qligini va qaysi portlar ochiqligini ko'rsatadi, ya'ni bu begonaga
tayyor xarita bo'lardi).

### Ogohlantirish

`claude` crontab: har 15 daqiqada **faqat o'zgarish** tekshiriladi, 09:00 (Toshkent)
da to'liq hisobot. Takroriy holat jim turadi — 2FA yo'qligi haftalab qizil turadi va
har 15 daqiqada xabar kelsa, odam ogohlantirishni o'chirib qo'yadi, keyin haqiqiy
hodisani ham ko'rmaydi. Yaxshilanish ham xabar qilinadi ("hal bo'ldi").

Holat: `data/qoriqchi-state.json` (600). Birinchi ishga tushirishda eski tarix
yuborilmaydi. Xabar faqat `OWNER_CHAT_ID` ga — guruhga emas. Boshqa chatga
yo'naltirish: `ALERT_CHAT_ID` muhit o'zgaruvchisi.

### Ball qanday hisoblanadi

Faqat **o'lchangan** tekshiruvlar bo'yicha: `info` (o'lchanmadi) holatidagi
tekshiruv maxrajga ham kirmaydi, uning o'rniga "o'lchanmadi: N" alohida
ko'rsatiladi. Ko'rmagan narsani "yaxshi" deb sanash — o'zini aldash.

### Deploy darvozani endi buzmaydi

`deploy.sh` repodagi nginx konfigini yuboradi, repoda esa kirish darvozasi
(`include .../sotuv-allow.conf`) YOQIQ holatda yozilgan. Jonli saytda u
o'chirilgan bo'lsa, har deploy uni beixtiyor qayta yoqib, xodimlarni bir necha
daqiqaga tashqarida qoldirardi (2026-09-09 da aynan shunday bo'ldi). Endi
`deploy.sh` yuborishdan oldin holatni o'qiydi va yuborgandan keyin o'shani
qaytaradi. Darvozani ataylab boshqarish: `/root/web-access.sh on|off|status`.
