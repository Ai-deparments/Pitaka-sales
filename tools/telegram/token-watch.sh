#!/bin/bash
# Telegram tokenlari tirikmi — har bir agent uchun getMe bilan tekshiradi.
#
# Nega kerak (2026-09-06 da real ko'rilgan): token @BotFather'da revoke qilinsa,
# systemd servisi hamon "active" ko'rinadi va bot.pid ham joyida turadi — lekin
# bot javob bermaydi. Tashqaridan hech narsa bilinmaydi.
#
# Ikkinchi sabab: watchdog.sh ogohlantirish uchun BIRINCHI topilgan tokenni oladi.
# Agar o'sha token o'lgan bo'lsa, nazoratning o'zi jimgina o'chadi. Shuning uchun
# bu skript xabarni faqat TEKSHIRILGAN tirik token orqali yuboradi.
set -u
BASE="${AI_AGENT_HOME:-/home/claude}"
LOG="$BASE/logs/infra/token-watch.log"
STATE="$BASE/logs/infra/token-watch.state"
mkdir -p "$(dirname "$LOG")"
ts() { TZ=Asia/Tashkent date '+%F %T'; }

declare -a DEAD=() ALIVE_TOKEN=() ALIVE_CHAT=()
for f in "$BASE"/secrets/telegram-*.env; do
  [ -f "$f" ] || continue
  agent="$(basename "$f" .env)"; agent="${agent#telegram-}"
  tok="$(grep -m1 '^TELEGRAM_BOT_TOKEN=' "$f" | cut -d= -f2- | tr -d '"'\''[:space:]')"
  chat="$(grep -m1 -E '^(OWNER_CHAT_ID|TELEGRAM_CHAT_ID)=' "$f" | cut -d= -f2- | tr -d '"'\''[:space:]')"
  [ -n "$tok" ] || continue
  # 3 marta urinamiz: bitta tarmoq uzilishi "token o'lgan" degani EMAS.
  # HTTP 000 = ulanib bo'lmadi (tarmoq), 401 = token haqiqatan yaroqsiz.
  code=""
  for urinish in 1 2 3; do
    code="$(curl -s -m 20 -o /dev/null -w '%{http_code}' "https://api.telegram.org/bot$tok/getMe")"
    [ "$code" = "200" ] && break
    [ "$code" = "401" ] && break   # yaroqsiz token — qayta urinish befoyda
    sleep 4
  done

  if [ "$code" = "200" ]; then
    ALIVE_TOKEN+=("$tok"); ALIVE_CHAT+=("$chat")
  elif [ "$code" = "401" ] || [ "$code" = "404" ]; then
    DEAD+=("$agent (HTTP $code — token yaroqsiz)")
  else
    # Tarmoq muammosi: ogohlantirmaymiz, faqat jurnalga yozamiz.
    echo "[$(ts)] tarmoq uzilishi: $agent (HTTP $code) — 3 urinishdan keyin, token aybdor emas" >> "$LOG"
    ALIVE_TOKEN+=("$tok"); ALIVE_CHAT+=("$chat")
  fi
done

if [ ${#DEAD[@]} -eq 0 ]; then
  echo "[$(ts)] hammasi tirik (${#ALIVE_TOKEN[@]} ta token)" >> "$LOG"
  : > "$STATE"
  exit 0
fi

MSG="Telegram tokeni ishlamayapti: ${DEAD[*]}
Servis 'active' ko'rinsa ham bu botlar javob bermaydi.
Tuzatish: @BotFather -> /token bilan yangisini oling, keyin
  secrets/telegram-<agent>.env va .claude-<agent>/channels/telegram/.env
ichidagi TELEGRAM_BOT_TOKEN ni almashtiring va servisni restart qiling."

# Bir xil holat haqida har 30 daqiqada takror yozmaymiz
SIG="$(printf '%s\n' "${DEAD[@]}" | sort | md5sum | cut -c1-16)"
if [ "$(cat "$STATE" 2>/dev/null)" = "$SIG" ]; then
  echo "[$(ts)] o'zgarmadi: ${DEAD[*]}" >> "$LOG"
  exit 1
fi
echo "$SIG" > "$STATE"
echo "[$(ts)] O'LIK TOKEN: ${DEAD[*]}" >> "$LOG"

# Xabarni faqat tirik token orqali yuboramiz
for i in "${!ALIVE_TOKEN[@]}"; do
  [ -n "${ALIVE_CHAT[$i]}" ] || continue
  curl -s -m 15 "https://api.telegram.org/bot${ALIVE_TOKEN[$i]}/sendMessage" \
    --data-urlencode "chat_id=${ALIVE_CHAT[$i]}" \
    --data-urlencode "text=${MSG}" >/dev/null && { echo "[$(ts)] ogohlantirish yuborildi" >> "$LOG"; break; }
done
exit 1
