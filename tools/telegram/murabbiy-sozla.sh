#!/bin/bash
# Telegram «shaxsiy murabbiy» boti tokenini serverga saqlaydi (2026-09-30).
#
# Egasi O'ZI ishga tushiradi — token chatga ham, panelga ham yozilmaydi:
#   ssh -t nova 'bash /home/claude/projects/sotuv-web/tools/telegram/murabbiy-sozla.sh'
#
# Token @BotFather dan olinadi (/newbot). Skript uni Telegram'da tekshiradi va
# /home/claude/secrets/murabbiy-bot.env ga (faqat claude o'qiydi, 600) yozadi.
# Pitaka sotuv paneli faylni daqiqasiga bir marta tekshiradi — qayta ishga tushirish shart emas.
# O'chirish: ... murabbiy-sozla.sh --ochir
set -euo pipefail
F=/home/claude/secrets/murabbiy-bot.env
umask 077
if [ ! -d /home/claude/secrets ]; then
  mkdir -p /home/claude/secrets
  if [ "$(id -u)" = "0" ]; then chown claude:claude /home/claude/secrets; fi
fi

if [ "${1:-}" = "--ochir" ]; then
  rm -f "$F"; echo "Token o'chirildi — murabbiy 1 daqiqa ichida to'xtaydi."; exit 0
fi
echo "Murabbiy boti tokenini joylang (ekranda ko'rinmaydi) va Enter bosing."
TOK=""
IFS= read -rs TOK || true
echo
TOK="$(printf '%s' "$TOK" | tr -d '[:space:]')"

if [ -z "$TOK" ]; then echo "Token kiritilmadi — hech narsa o'zgarmadi."; exit 0; fi
if ! [[ "$TOK" =~ ^[0-9]{5,}:[A-Za-z0-9_-]{30,}$ ]]; then
  echo "Token formati noto'g'ri (ko'rinishi: 123456789:AA...). Qaytadan urinib ko'ring."; exit 1
fi
J="$(curl -s -m 20 "https://api.telegram.org/bot${TOK}/getMe" || true)"
if ! printf '%s' "$J" | grep -q '"ok":true'; then
  echo "Telegram bu tokenni qabul qilmadi. @BotFather'dan tokenni qayta nusxalang."; exit 1
fi
U="$(printf '%s' "$J" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')"

printf 'MURABBIY_BOT_TOKEN=%s\n' "$TOK" > "$F.tmp"
mv "$F.tmp" "$F"
chmod 600 "$F"
if [ "$(id -u)" = "0" ]; then chown claude:claude "$F"; fi
unset TOK J
echo "Saqlandi: @${U}. Panel 1–2 daqiqada botni o'zi ulaydi."
echo "Keyin: panel → Qo'ng'iroqlar → «Murabbiy» — holat «ulangan» bo'ladi, operatorlar «Telegram'da ulash» ni bosadi."
