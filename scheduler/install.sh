#!/usr/bin/env bash
# qq-bot-scheduler 安装脚本
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
BIN=/opt/bin/qq-bot-scheduler
CONF=/etc/qq-bot/schedule.conf
UNITS=/etc/systemd/system

[[ $EUID -eq 0 ]] || { echo "请用 root 运行（sudo ./install.sh）" >&2; exit 1; }

echo "[1/4] 安装主脚本 -> $BIN"
install -d /opt/bin
install -m 755 "$HERE/qq-bot-scheduler.sh" "$BIN"

echo "[2/4] 安装配置 -> $CONF"
install -d /etc/qq-bot
[[ -f "$CONF" ]] || install -m 644 "$HERE/schedule.conf" "$CONF"
[[ -f /etc/qq-bot/holidays.txt ]] || echo "# 法定节假日，每行 YYYY-MM-DD" > /etc/qq-bot/holidays.txt
[[ -f /etc/qq-bot/workdays.txt  ]] || echo "# 调休上班日，每行 YYYY-MM-DD" > /etc/qq-bot/workdays.txt

echo "[3/4] 安装 systemd unit"
install -m 644 "$HERE/systemd/qq-schedule.service" "$UNITS/qq-schedule.service"
install -m 644 "$HERE/systemd/qq-schedule.timer"   "$UNITS/qq-schedule.timer"
systemctl daemon-reload

echo "[4/4] 启用并立即应用一次"
systemctl enable --now qq-schedule.timer
systemctl start qq-schedule.service || true
sleep 2
"$BIN" status

echo
echo "完成。常用命令："
echo "  qq-bot-scheduler status | report | force peak|offpeak|night|auto | rotate"
