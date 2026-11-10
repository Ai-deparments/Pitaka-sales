# Odoo sotuv avtomatlashtiruvi (`tools/odoo-avtomat/`)

Videoda (14.09.2026) koʻrsatilgan qoʻl ishini avtomatlashtiradi: **lid → kvalifikatsiya → kalkulyator → КП maydonlari → keyingi qadam**.
Ulanish — agentlar bilan **bir xil Odoo MCP kaliti** (`secrets/odoo-mcp.env` yoki agent `.claude.json`); kalit hech qayerga chiqmaydi.

## Buyruqlar

```bash
cd /home/claude/projects/sotuv-web/tools/odoo-avtomat

node avtomat.mjs holat                      # ulanish, yozuv sonlari, kalkulyator/toʻplam/narx sinovi
node avtomat.mjs lid --nom "Ali Valiyev" --telefon 901112233 [--xudud Toshkent] [--manba "Кирувчи қўнғироқ"] [--yoz]
node avtomat.mjs kvalifikatsiya <id> --maqsad 1 --stansiya On-Grid --oylik-tolov 500000 [--tip Истемолчи] [--yoz]
node avtomat.mjs kp <id> [--tom tekis|qiya] [--kvt 20] [--narx-tasdiq] [--docx] [--yoz]
node avtomat.mjs sinov [--lid <id>] [--yoz]  # uchdan-uchiga: yaratadi/toʻldiradi/oʻqiydi/arxivlaydi
```

**Standart rejim — SINOV (dry-run):** nima yozilishini koʻrsatadi, CRM'ga tegmaydi. Yozish uchun `--yoz`.
**Narx** faqat `--narx-tasdiq` bilan yoziladi (`qoida.json > narx_kitobi._tasdiq` = `kutilmoqda` boʻlsa bloklangan) — taxminiy narx CRM'ga tushmasligi uchun.

## Nima avtomat boʻladi

| Qadam | Nima yoziladi |
|---|---|
| Lid | `name`, `contact_name`, `type`, `phone` (+998 formatga keltiriladi), keyin `Тип клиента` → `xudud`/`city` → `team_id` |
| Dublikat | telefon boʻyicha tekshiradi; topilsa yaratmaydi (videodagi «Похожие лиды» oʻrnida) |
| Kalkulyator | oylik toʻlov → kVt·soat (`tarif_som_kwh`) → yillik → **kerakli kVt** (`unum_kwh_kvt_yil`) → pogʻonaga yaxlitlash; tavsiya = `tavsiya_koef` |
| Marshrut | ≤50 kVt call-center · >50 kVt menejer obyektga (savolnoma) |
| Toʻlov | ≤30 kVt 100% avans · >30 kVt 60/20/20 |
| КП | `Тариф`, `Панел бренди`, `Инвертор`, `Invertor quvvati/fazasi`, `Konstruksiya materiali` + (tasdiq bilan) 1 kVt narx va stansiya narxi |
| Keyingi qadam | `odoo_activity_schedule` — muddat bilan |

## Hozirgi cheklovlar (Odoo tomonda, kod tayyor)

| Cheklov | Taʼsiri | Yechim |
|---|---|---|
| `crm.lead` koʻrinishi: kalit faqat «Test» jamoasini koʻradi | SUN-HIGHTECH'ning 165 «Янги лид»i koʻrinmaydi | MCP user → CRM «User: All Documents» yoki SUN jamoalariga aʼzolik |
| `res.company` oʻqish yoʻq | `team_id`ni **yaratishda** qoʻyib boʻlmaydi (hozir `write` bilan aylanib oʻtiladi) | scope'ga `res.company` (oʻqish) |
| `x_panel`, `x_power`, `x_crm_lead_line_ccd84` scope'da yoʻq | КП'ning 42 qatorli spetsifikatsiyasi va oylik istemol qatorlari yozilmaydi | scope'ga shu 3 model |
| `x_studio_garanty` yozilmaydi | kafolat maydoni boʻsh qoladi | Odoo tomonda toʻplamdan keladi (aniqlanishi kerak) |
| Narx/toʻplam tasdiqlanmagan | avtomat narx yozmaydi | `qoida.json` da `_tasdiq` → `tasdiqlandi` + haqiqiy raqamlar |

## Parametrlar — `qoida.json`

Kod oʻzgarmaydi, faqat shu fayl: maydon xaritasi (41), variantlar, kalkulyator konstantalari, narx kitobi, toʻplam jadvali, toʻlov/marshrut qoidalari, majburiy maydonlar, server amallari (`КП=1937`, `Шартнома=1871`, `Учрашув=563`).

## Agentlar uchun

`/home/claude/scripts/agents/sotuv-avtomat.sh` — oʻram. Agent faqat **sinov rejimida** koʻrsatadi; yozish uchun `--yoz` egasining buyrugʻi bilan.
Isbotlangan jonli sinov: `#43050` (16.09.2026) — create ✓, Тип клиента ✓, team_id ✓, kvalifikatsiya ✓, КП ✓, aktivlik ✓, arxiv ✓, 0 xato.
