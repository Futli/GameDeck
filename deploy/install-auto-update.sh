#!/usr/bin/env bash
# Включить автообновление: таймер systemd, который раз в 2 минуты запускает auto-update.sh.
# Запуск на сервере от root, один раз:  bash /opt/gamedeck/deploy/install-auto-update.sh
# Выключить:  systemctl disable --now gamedeck-update.timer
set -euo pipefail

REPO_DIR=${REPO_DIR:-/opt/gamedeck}
[[ $EUID -eq 0 ]] || { echo "Нужен root" >&2; exit 1; }
[[ -x $REPO_DIR/deploy/auto-update.sh ]] || chmod +x "$REPO_DIR/deploy/auto-update.sh"

cat > /etc/systemd/system/gamedeck-update.service <<UNIT
[Unit]
Description=Обновление GameDeck до свежего main
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=REPO_DIR=$REPO_DIR
ExecStart=$REPO_DIR/deploy/auto-update.sh
UNIT

cat > /etc/systemd/system/gamedeck-update.timer <<UNIT
[Unit]
Description=Проверять обновления GameDeck раз в 2 минуты

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now gamedeck-update.timer
echo "Автообновление включено. Журнал: journalctl -u gamedeck-update.service -n 50"
