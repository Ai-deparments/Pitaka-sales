#!/bin/bash
# Xavfsizlik qo'riqchisi — cron uchun o'ram.
#   qoriqchi.sh          -> o'zgarish tekshiruvi (har 15 daqiqa)
#   qoriqchi.sh digest   -> kunlik to'liq hisobot
set -u
BASE="${AI_AGENT_HOME:-/home/claude}"
APP="$BASE/projects/sotuv-web"
LOG="$BASE/logs/infra/qoriqchi.log"
mkdir -p "$(dirname "$LOG")"
cd "$APP" || exit 1
ARG=""
[ "${1:-}" = "digest" ] && ARG="--digest"
echo "$(TZ=Asia/Tashkent date '+%F %T') $(/usr/bin/node tools/telegram/qoriqchi-alerts.mjs $ARG 2>&1 | tr '\n' ' ')" >> "$LOG"
