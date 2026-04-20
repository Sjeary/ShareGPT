#!/usr/bin/env bash
set -euo pipefail

APP_NAME="sharegpt-collab"
SERVICE_NAME="sharegpt-collab"
APP_USER="sharegpt"
APP_GROUP="sharegpt"
INSTALL_DIR="/opt/sharegpt-collab"
PORT="${PORT:-8088}"
HOST="${HOST:-0.0.0.0}"
SESSION_TTL_MS="${SESSION_TTL_MS:-86400000}"
HISTORY_MAX="${HISTORY_MAX:-200}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "[info] 需要 root 权限，尝试使用 sudo 重新执行..."
  exec sudo -E bash "$0" "$@"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[1/7] 安装系统依赖"
apt-get update
apt-get install -y curl ca-certificates gnupg rsync

NEED_INSTALL_NODE="0"
if ! command -v node >/dev/null 2>&1; then
  NEED_INSTALL_NODE="1"
else
  NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  if [[ "${NODE_MAJOR}" -lt 20 ]]; then
    NEED_INSTALL_NODE="1"
  fi
fi

if [[ "${NEED_INSTALL_NODE}" == "1" ]]; then
  echo "[2/7] 安装 Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "[2/7] Node.js 版本可用: $(node -v)"
fi

echo "[3/7] 创建运行账号"
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "${APP_USER}"
fi

echo "[4/7] 同步程序到 ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
rsync -a --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude '*.bat' \
  "${SCRIPT_DIR}/" "${INSTALL_DIR}/"
chown -R "${APP_USER}:${APP_GROUP}" "${INSTALL_DIR}"

echo "[5/7] 安装 Node 依赖"
if [[ -f "${INSTALL_DIR}/package-lock.json" ]]; then
  sudo -u "${APP_USER}" npm --prefix "${INSTALL_DIR}" ci --omit=dev
else
  sudo -u "${APP_USER}" npm --prefix "${INSTALL_DIR}" install --omit=dev
fi

echo "[6/7] 生成 systemd 服务"
cat >/etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=ShareGPT Collaboration Server
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${INSTALL_DIR}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
Environment=HOST=${HOST}
Environment=USERS_FILE=${INSTALL_DIR}/data/users.json
Environment=SESSION_TTL_MS=${SESSION_TTL_MS}
Environment=HISTORY_MAX=${HISTORY_MAX}
ExecStart=/usr/bin/env node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now ${SERVICE_NAME}

echo "[7/7] 防火墙与状态"
if command -v ufw >/dev/null 2>&1; then
  ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true
fi

systemctl --no-pager --full status ${SERVICE_NAME} || true

echo ""
echo "部署完成。"
echo "健康检查: curl http://127.0.0.1:${PORT}/api/health"
echo "日志查看:   journalctl -u ${SERVICE_NAME} -f"

