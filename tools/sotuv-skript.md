# SUN-HIGHTECH sotuv qo'ng'irog'i skripti — 3 zaif mezon uchun

Qo'ng'iroq tahlili 8 mezon bo'yicha baholaydi. Tajriba shuni ko'rsatadi: jamoa **tinglaydi** va **e'tirozni yumshatadi**,
lekin **savol bermaydi**, **SUN-HIGHTECH qiymatini aytmaydi** va **keyingi qadamni belgilamaydi**.
Bu skript aynan shu uchta joyni yopadi. Har qo'ng'iroqda 3 ta blokdan kamida bittadan gap aytilsin.
Demo davrida raqamlar «Премиум 30°» kalkulyatori va savolnoma (12.09.2026) asosida; real tahlil to'plangach qayta kalibrlanadi (§10.4).

## 1. To'g'ri savollar (yopiq emas, ochiq: «nima uchun», «qanday», «qancha»)

Maqsad: mijozning og'rig'ini o'z og'zidan eshitish va quvvatni aniqlash. Kamida 4 ta savol.

- «Oylik elektr uchun **qancha** to'layapsiz — so'mda yoki kVt·soatda?» (5 kVt ≈ 750 kVt·soat/oy)
- «Obyekt **qaysi** viloyatda, tom **qanday** — tekis, 30° qiya, yoki yerga qo'yiladi?»
- «Elektr **nima uchun** kerak — tejash, uzilishlar, yoki ortiqchasini tarmoqqa sotish («Quyoshli xonadon»)?»
- «Uy egasisizmi yoki korxona? Korxona bo'lsa — yillik sarf **taxminan qancha**?» (yillik kVt·soat ÷ 1 500 = quvvat)
- «Qarorni **kim bilan** qilasiz — o'zingiz, direktor, xarid bo'limi?»
- «**Qachongacha** o'rnatmoqchisiz — mavsumgacha, yil oxirigacha?»
- «Tarmoq ruxsati (MyGov / ХЭТК) bilan avval ishlaganmisiz?»

Taqiq: «Stansiya kerakmi?» (ha/yo'q savol). O'rniga: «Qaysi masalani hal qilmoqchisiz — hisob, uzilish, daromad?»

## 2. SUN-HIGHTECH qiymati — tejash, kafolat, monitoring tilida (xususiyat emas)

Formula: **Muammo → Bizda → Natija**. Faktlar (haqiqiy, o'ylab topilmagan):

- O'z konstruksiyasi, rux qoplamali — qo'lda payvandlangan ramka emas.
- Panellar: Jinko / Longi / JA / Trina; invertor: Sungrow. **5 yil bepul kafolat + monitoring.**
- To'lov: ≤30 kVt — 100% avans; >30 kVt — 60% avans, 20% jihoz kelganda, 20% ishga tushganda.
- Narx pog'onali: 5 kVt ≈ 6,1 mln/kVt … 1 MVt ≈ 4,5 mln/kVt (narx faqat narx kitobidan; chegirma — menejer 5% gacha, undan yuqori direktor).

Namuna gaplar:
- Hisob og'ir → «10 kVt tizim oyiga ~1 500 kVt·soat beradi — hozirgi hisobingizning katta qismi yopiladi, ortiqchasi «Quyoshli xonadon» bo'yicha tarmoqqa ketadi. Aniq raqamni hisobingiz bilan 10 daqiqada chiqaraman.»
- Uzilishlar → «Kunduzi stansiya, kechasi tarmoq; batareya variantini alohida hisoblaymiz — 3 ssenariyda ko'rsataman.»
- Sifat xavotiri → «Konstruksiya o'zimizniki, rux qoplamali; panel va invertor — dunyo brendlari; 5 yil kafolat va monitoring ilovasi — muammo bo'lsa siz emas, biz ko'ramiz.»
- Muddat → «Shartnomadan keyin MyGov 3 kun, ХЭТК 3 kun, montaj 7–14 kun — tartibni har bosqichda yozib turamiz.»

Taqiq: «Biz eng yaxshimiz», «eng arzon» — dalilsiz gaplar; tannarx/marja haqida gap yo'q.

## 3. Keyingi qadam — sana, vaqt, mas'ul bilan (suhbat oxirida majburiy)

- «Ertaga soat 11 da hisob va 2 variantli taklifni yuboraman — Telegram yoki emailga?»
- «Payshanba 15:00 da muhandis obyektga chiqadi — manzil va telefon shu raqammi?» (>50 kVt)
- «Kvitansiyaning rasmini tashlab yuboring — 10 daqiqada hisobni qaytaraman.» (≤50 kVt, call-center)
- «Qaror uchun kim bilan gaplashasiz? Unga ham taklifni yuboraymi?»

Taqiq: «Keyinroq bog'lanamiz» — sanasiz. Har qo'ng'iroq CRM'da aniq keyingi qadam (sana + mas'ul) bilan yopiladi.

## E'tirozlar (kod → javob)

| Kod | Mijoz | Javob yo'nalishi |
|---|---|---|
| `narx` | «Qimmat, boshqalar 3 mln/kVt» | Nega 4,5: konstruksiya, brend, kafolat 5 yil, monitoring; qaytim yillari raqam bilan |
| `muddatli_tolov` | «Bo'lib to'lasam bo'ladimi?» | >30 kVt — 60/20/20; ≤30 kVt — 100%; bank/lizing bo'lsa — direktor bilan kelishiladi, va'da bermang |
| `tarmoq` | «Ruxsat olish qiyin» | MyGov 3 kun, ХЭТК 3 kun, inspeksiya 10 kun — biz yuritamiz, mijoz faqat imzolaydi |
| `keyinroq` | «Hozir emas» | Qachon? Sabab? Mavsum/narx o'zgarishi; aniq sana bilan eslatma |
| `ishonch` | «Kompaniyangizni bilmayman» | O'rnatilgan obyektlar, monitoring ko'rsatuvi, kafolat kartasi |
