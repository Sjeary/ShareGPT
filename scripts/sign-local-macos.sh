#!/usr/bin/env bash
set -euo pipefail

if [[ "${CI:-}" == "true" ]]; then
  echo "Local ShareGPT signing is forbidden in CI. Use a Developer ID certificate from GitHub Secrets." >&2
  exit 1
fi

if [[ $# -ne 1 || ! -d "$1" || "$1" != *.app ]]; then
  echo "Usage: $0 /path/to/ShareGPT.app" >&2
  exit 1
fi

APP_PATH="$1"
IDENTITY_NAME="ShareGPT Local Code Signing"
SIGNING_DIR="${SHAREGPT_LOCAL_SIGNING_DIR:-${HOME}/Library/Application Support/ShareGPT Local Signing}"
KEYCHAIN_PATH="${SIGNING_DIR}/sharegpt-local-signing.keychain-db"
PASSWORD_FILE="${SIGNING_DIR}/keychain-password"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIGN_TOOL="${REPO_ROOT}/scripts/sign-local-macos.mjs"

if [[ ! -f "${KEYCHAIN_PATH}" || ! -f "${PASSWORD_FILE}" ]]; then
  echo "Local signing identity is not initialized. Run: npm run setup:mac-signing:local" >&2
  exit 1
fi
if [[ ! -f "${SIGN_TOOL}" || ! -d "${REPO_ROOT}/node_modules/@electron/osx-sign" ]]; then
  echo "The local signing helper is unavailable. Run npm ci first." >&2
  exit 1
fi

KEYCHAIN_PASSWORD="$(<"${PASSWORD_FILE}")"
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
IDENTITY_HASH="$({ security find-identity -v -p codesigning "${KEYCHAIN_PATH}" || true; } \
  | awk -v name="${IDENTITY_NAME}" 'index($0, "\"" name "\"") { print $2; exit }')"
if [[ -z "${IDENTITY_HASH}" ]]; then
  echo "Code-signing identity not found: ${IDENTITY_NAME}" >&2
  exit 1
fi

node "${SIGN_TOOL}" "${APP_PATH}" "${IDENTITY_HASH}" "${KEYCHAIN_PATH}"
codesign --verify --deep --strict --verbose=2 "${APP_PATH}"

SIGNATURE_DETAILS="$(codesign -dvv "${APP_PATH}" 2>&1)"
if ! grep -Fq "Authority=${IDENTITY_NAME}" <<<"${SIGNATURE_DETAILS}"; then
  echo "Unexpected local signing authority." >&2
  exit 1
fi
if ! grep -Fq "flags=0x0(none)" <<<"${SIGNATURE_DETAILS}"; then
  echo "Local self-signed builds must not enable hardened runtime." >&2
  exit 1
fi

FRAMEWORK_PATH="${APP_PATH}/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework"
FRAMEWORK_DETAILS="$(codesign -dvv "${FRAMEWORK_PATH}" 2>&1)"
if ! grep -Fq "Authority=${IDENTITY_NAME}" <<<"${FRAMEWORK_DETAILS}" || \
  ! grep -Fq "flags=0x0(none)" <<<"${FRAMEWORK_DETAILS}"; then
  echo "Electron Framework does not match the local app signing policy." >&2
  exit 1
fi

LOWER_IDENTITY_HASH="$(printf '%s' "${IDENTITY_HASH}" | tr '[:upper:]' '[:lower:]')"
DESIGNATED_REQUIREMENT="$(codesign -d -r- "${APP_PATH}" 2>&1)"
if ! grep -Fq "certificate root = H\"${LOWER_IDENTITY_HASH}\"" <<<"${DESIGNATED_REQUIREMENT}"; then
  echo "The app designated requirement is not bound to the stable local certificate." >&2
  exit 1
fi
echo "Signed ${APP_PATH} with ${IDENTITY_NAME}"
