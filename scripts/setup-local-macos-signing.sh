#!/usr/bin/env bash
set -euo pipefail

if [[ "${CI:-}" == "true" ]]; then
  echo "Local macOS signing identities must never be created in CI." >&2
  exit 1
fi

IDENTITY_NAME="ShareGPT Local Code Signing"
SIGNING_DIR="${SHAREGPT_LOCAL_SIGNING_DIR:-${HOME}/Library/Application Support/ShareGPT Local Signing}"
KEYCHAIN_PATH="${SIGNING_DIR}/sharegpt-local-signing.keychain-db"
PASSWORD_FILE="${SIGNING_DIR}/keychain-password"

mkdir -p "${SIGNING_DIR}"
chmod 700 "${SIGNING_DIR}"

if [[ ! -f "${PASSWORD_FILE}" ]]; then
  umask 077
  openssl rand -base64 48 >"${PASSWORD_FILE}"
fi
chmod 600 "${PASSWORD_FILE}"
KEYCHAIN_PASSWORD="$(<"${PASSWORD_FILE}")"

if [[ ! -f "${KEYCHAIN_PATH}" ]]; then
  security create-keychain -p "${KEYCHAIN_PASSWORD}" "${KEYCHAIN_PATH}"
fi
security set-keychain-settings -lut 21600 "${KEYCHAIN_PATH}"
security unlock-keychain -p "${KEYCHAIN_PASSWORD}" "${KEYCHAIN_PATH}"

KEYCHAIN_LIST=()
while IFS= read -r ITEM; do
  ITEM="${ITEM#*\"}"
  ITEM="${ITEM%\"*}"
  [[ -n "${ITEM}" ]] && KEYCHAIN_LIST+=("${ITEM}")
done < <(security list-keychains -d user)
if [[ ! " ${KEYCHAIN_LIST[*]} " =~ " ${KEYCHAIN_PATH} " ]]; then
  security list-keychains -d user -s "${KEYCHAIN_LIST[@]}" "${KEYCHAIN_PATH}"
fi

if security find-identity -v -p codesigning "${KEYCHAIN_PATH}" | grep -Fq "\"${IDENTITY_NAME}\""; then
  echo "Local signing identity is ready: ${IDENTITY_NAME}"
  exit 0
fi

TEMP_DIR="$(mktemp -d /private/tmp/sharegpt-local-signing.XXXXXX)"
trap 'rm -rf "${TEMP_DIR}"' EXIT

cat >"${TEMP_DIR}/openssl.cnf" <<EOF
[req]
distinguished_name = distinguished_name
x509_extensions = code_signing
prompt = no

[distinguished_name]
CN = ${IDENTITY_NAME}
O = ShareGPT Local Development

[code_signing]
basicConstraints = critical,CA:true
keyUsage = critical,digitalSignature,keyCertSign
extendedKeyUsage = codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
EOF

openssl req -new -newkey rsa:3072 -nodes -x509 -days 3650 \
  -config "${TEMP_DIR}/openssl.cnf" \
  -keyout "${TEMP_DIR}/identity.key" \
  -out "${TEMP_DIR}/identity.crt"
openssl pkcs12 -export -legacy \
  -name "${IDENTITY_NAME}" \
  -inkey "${TEMP_DIR}/identity.key" \
  -in "${TEMP_DIR}/identity.crt" \
  -out "${TEMP_DIR}/identity.p12" \
  -passout "pass:${KEYCHAIN_PASSWORD}"

security import "${TEMP_DIR}/identity.p12" \
  -k "${KEYCHAIN_PATH}" \
  -P "${KEYCHAIN_PASSWORD}" \
  -T /usr/bin/codesign \
  -T /usr/bin/security
security add-trusted-cert -r trustRoot -k "${KEYCHAIN_PATH}" "${TEMP_DIR}/identity.crt"
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "${KEYCHAIN_PASSWORD}" \
  "${KEYCHAIN_PATH}" >/dev/null

security find-identity -v -p codesigning "${KEYCHAIN_PATH}" | grep -F "\"${IDENTITY_NAME}\""
echo "Local signing identity created in ${KEYCHAIN_PATH}"
