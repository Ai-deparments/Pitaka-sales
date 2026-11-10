#!/bin/bash
# Kritik qo'ng'iroq ogohlantirishlari — navbatni bo'shatadi.
# Cron tez-tez chaqiradi; navbat bo'sh bo'lsa skript darrov chiqadi, xabar yubormaydi.
set -u
BASE=/home/claude
APP="$BASE/projects/sotuv-web"
LOG="$BASE/logs/infra/call-alerts.log"
# Qulf /tmp da emas: u yerda fayl boshqa foydalanuvchi nomidan yaratilib qolsa,
# `exec 9>` jimgina yiqiladi va ogohlantirishlar hech qachon ketmaydi.
LOCK="$BASE/logs/infra/call-alerts.lock"
mkdir -p "$(dirname "$LOCK")" 2>/dev/null
exec 9>"$LOCK" || { echo "qulf ochilmadi: $LOCK" >&2; exit 1; }
flock -n 9 || exit 0                      # oldingisi tugamagan bo'lsa — o'tkazib yuboramiz
run_node() {
  if [ "$(id -un)" = "claude" ]; then node "$@"; else sudo -u claude env HOME="$BASE" node "$@"; fi
}
cd "$APP" || exit 1
OUT="$(run_node "$APP/tools/telegram/call-alerts.mjs" 2>&1)"
RC=$?
[ -n "$OUT" ] && echo "[$(TZ=Asia/Tashkent date '+%F %T')] $OUT" >> "$LOG"
exit $RC
