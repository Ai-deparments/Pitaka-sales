#!/bin/bash
# Konveyer — cron har 10 daqiqada chaqiradi. Navbat bo'sh bo'lsa darrov chiqadi.
set -u
BASE=/home/claude
APP="$BASE/projects/sotuv-web"
LOG="$BASE/logs/infra/call-worker.log"
LOCK="$BASE/logs/infra/call-worker.lock"
mkdir -p "$(dirname "$LOCK")" 2>/dev/null
exec 9>"$LOCK" || { echo "qulf ochilmadi" >&2; exit 1; }
# Oldingi sikl tugamagan bo'lsa o'tkazib yuboramiz: AI tahlili uzoq davom etadi
# va ikkita ishchi bir qo'ng'iroqni ikki marta ishlashiga yo'l qo'ymaymiz.
flock -n 9 || exit 0
run_node() {
  if [ "$(id -un)" = "claude" ]; then node "$@"; else sudo -u claude env HOME="$BASE" node "$@"; fi
}
cd "$APP" || exit 1
# 2026-09-23: Odoo'dagi SUN qo'ng'iroqlari (fevral–iyul, ~2 900 ta) ham AI tahlildan o'tsin.
# Eng yangisidan boshlab; kunduzi sekin (8 ta sotuv agenti ham `claude` dan foydalanadi),
# kechasi tezroq. Yangi qo'ng'iroq kelsa — u eng yangi, shuning uchun birinchi tahlil qilinadi.
SOAT=$(TZ=Asia/Tashkent date +%H)
if [ "$SOAT" -ge 22 ] || [ "$SOAT" -lt 8 ]; then LIM_STD=10; else LIM_STD=3; fi
{ echo "--- $(TZ=Asia/Tashkent date '+%F %T') ---"
  run_node "$APP/tools/call-worker.mjs" --limit "${WORKER_LIMIT:-$LIM_STD}" --days "${WORKER_DAYS:-366}" --yangidan
} >> "$LOG" 2>&1
