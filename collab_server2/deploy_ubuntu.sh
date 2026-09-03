#!/usr/bin/env bash
set -euo pipefail

APP_NAME="sharegpt-collab"
SERVICE_NAME="sharegpt-collab"
APP_USER="sharegpt"
APP_GROUP="sharegpt"
INSTALL_DIR="/opt/sharegpt-collab"
DATA_DIR="${DATA_DIR:-/var/lib/sharegpt-collab}"
ENV_FILE="/etc/sharegpt-collab.env"
PORT="${PORT:-8088}"
HOST="${HOST:-127.0.0.1}"
SESSION_TTL_MS="${SESSION_TTL_MS:-86400000}"
HISTORY_MAX="${HISTORY_MAX:-200}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "[info] 需要 root 权限，尝试使用 sudo 重新执行..."
  exec sudo -E bash "$0" "$@"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[1/7] 安装系统依赖"
apt-get update
apt-get install -y curl ca-certificates gnupg openssl rsync

NEED_INSTALL_NODE="0"
if ! command -v node >/dev/null 2>&1; then
  NEED_INSTALL_NODE="1"
else
  if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)'; then
    NEED_INSTALL_NODE="1"
  fi
fi

if [[ "${NEED_INSTALL_NODE}" == "1" ]]; then
  echo "[2/7] 安装 Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
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
mkdir -p "${DATA_DIR}/releases" "${DATA_DIR}/release_shared"

# 旧版脚本把数据放在安装目录。升级时只复制缺失文件，并保留原目录作为回滚副本。
if [[ "${DATA_DIR}" != "${INSTALL_DIR}/data" && -d "${INSTALL_DIR}/data" ]]; then
  rsync -a --ignore-existing "${INSTALL_DIR}/data/" "${DATA_DIR}/"
fi

rsync -a --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude data \
  --exclude release_shared \
  --exclude '*.bat' \
  "${SCRIPT_DIR}/" "${INSTALL_DIR}/"
chown -R "${APP_USER}:${APP_GROUP}" "${INSTALL_DIR}"
chown -R "${APP_USER}:${APP_GROUP}" "${DATA_DIR}"
chmod 750 "${DATA_DIR}"

echo "[5/7] 安装 Node 依赖"
if [[ -f "${INSTALL_DIR}/package-lock.json" ]]; then
  sudo -u "${APP_USER}" npm --prefix "${INSTALL_DIR}" ci --omit=dev
else
  sudo -u "${APP_USER}" npm --prefix "${INSTALL_DIR}" install --omit=dev
fi

echo "[6/7] 生成 systemd 服务"
if [[ ! -f "${ENV_FILE}" ]]; then
  umask 077
  printf 'SHAREGPT_TRANSLATION_MASTER_KEY=%s\n' "$(openssl rand -base64 32)" >"${ENV_FILE}"
elif ! grep -q '^SHAREGPT_TRANSLATION_MASTER_KEY=' "${ENV_FILE}"; then
  printf 'SHAREGPT_TRANSLATION_MASTER_KEY=%s\n' "$(openssl rand -base64 32)" >>"${ENV_FILE}"
fi
chown root:root "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

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
EnvironmentFile=-${ENV_FILE}
Environment=PORT=${PORT}
Environment=HOST=${HOST}
Environment=USERS_FILE=${DATA_DIR}/users.json
Environment=GPT_USAGE_FILE=${DATA_DIR}/gpt_usage.json
Environment=CHAT_HISTORY_FILE=${DATA_DIR}/chat_history.json
Environment=CLIENT_BOOTSTRAP_FILE=${DATA_DIR}/client_bootstrap.json
Environment=CALENDARS_FILE=${DATA_DIR}/calendars.json
Environment=USER_STORES_FILE=${DATA_DIR}/user_stores.json
Environment=FOCUS_FILE=${DATA_DIR}/focus_stats.json
Environment=AIRPORT_FILE=${DATA_DIR}/airport.json
Environment=PROXY_ROUTES_FILE=${DATA_DIR}/proxy_routes.json
Environment=PROXY_ROUTE_HEALTH_FILE=${DATA_DIR}/proxy_route_health.json
Environment=TRANSLATION_PROFILES_FILE=${DATA_DIR}/translation_profiles.json
Environment=TRANSLATION_USAGE_FILE=${DATA_DIR}/translation_usage.json
Environment=RELEASES_DIR=${DATA_DIR}/releases
Environment=RELEASE_STORE=${DATA_DIR}/release_shared
Environment=SHARED_RELEASE_FILE=${DATA_DIR}/release_shared/release.json
Environment=SESSION_TTL_MS=${SESSION_TTL_MS}
Environment=HISTORY_MAX=${HISTORY_MAX}
ExecStart=/usr/bin/env node server.js
Restart=always
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now ${SERVICE_NAME}

echo "[7/7] 服务状态"
systemctl --no-pager --full status ${SERVICE_NAME} || true

echo ""
echo "部署完成。"
echo "健康检查: curl http://127.0.0.1:${PORT}/api/health"
echo "日志查看:   journalctl -u ${SERVICE_NAME} -f"
echo "数据目录:   ${DATA_DIR}"
if [[ "${HOST}" != "127.0.0.1" && "${HOST}" != "localhost" && "${HOST}" != "::1" ]]; then
  echo "警告: HOST=${HOST} 会监听非回环地址；脚本不会自动开放防火墙，请自行限制来源并启用 HTTPS。"
else
  echo "公网入口:   请用 Caddy/Nginx 将 HTTPS 反向代理到 127.0.0.1:${PORT}"
fi
