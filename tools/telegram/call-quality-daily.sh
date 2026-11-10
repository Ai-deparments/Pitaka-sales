#!/bin/bash
# Kunlik qo'ng'iroq sifati hisoboti — Toshkent vaqti bilan 09:40 dan keyin, kuniga BIR MARTA.
# Vaqt qo'riqchisi ataylab shu yerda: cron server vaqtida ishlaydi va DST'da suriladi,
# cron qatoridagi qo'riqchi ilgari ishlamay qolgan (rules-daily.sh dagi saboq).
set -u
BASE=/home/claude
APP="$BASE/projects/sotuv-web"
LOCK="$BASE/logs/infra/call-quality.lastrun"
LOG="$BASE/logs/infra/call-quality.log"
TODAY="$(TZ=Asia/Tashkent date +%F)"
NOW="$(TZ=Asia/Tashkent date +%H%M)"
# Cron `claude` foydalanuvchisi ostida ishlaydi. Root'dan qo'lda ishga tushirilsa ham
# ishlashi uchun sudo'ga tushamiz. (Root cron `claude` egalik qilgan skriptni
# chaqirmasligi kerak — bu huquq oshirish yo'li.)
run_node() {
  if [ "$(id -un)" = "claude" ]; then node "$@"; else sudo -u claude env HOME="$BASE" node "$@"; fi
}
ts() { TZ=Asia/Tashkent date '+%F %T'; }

DOW="$(TZ=Asia/Tashkent date +%u)"
[ "$DOW" -ge 6 ] && exit 0                       # dushanba–juma
[ "$NOW" \< "0940" ] && exit 0                   # 09:40 dan keyin
[ "$(cat "$LOCK" 2>/dev/null)" = "$TODAY" ] && exit 0   # bugun yuborilgan

echo "[$(ts)] hisobot yuborilmoqda..." >> "$LOG"
if cd "$APP" && run_node "$APP/tools/telegram/call-quality-report.mjs" >> "$LOG" 2>&1; then
  echo "$TODAY" > "$LOCK"
  echo "[$(ts)] yuborildi" >> "$LOG"
else
  echo "[$(ts)] XATO — ertaga qayta urinadi" >> "$LOG"
fi
