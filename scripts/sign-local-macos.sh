#!/usr/bin/env bash
set -euo pipefail

if [[ "${CI:-}" == "true" ]]; then
  echo "Local ShareGPT signing is forbidden in CI. Use Developer ID credentials." >&2
  exit 1
fi
if [[ $# -ne 1 || ! -d "$1" || "$1" != *.app ]]; then
  echo "Usage: $0 /path/to/ShareGPT.app" >&2
  exit 1
fi

APP_PATH="$1"
node "$(dirname "$0")/sign-local-macos.mjs" "${APP_PATH}"
codesign --verify --deep --strict --verbose=2 "${APP_PATH}"
DETAILS="$(codesign -dvv "${APP_PATH}" 2>&1)"
grep -Fq "Signature=adhoc" <<<"${DETAILS}"
if grep -Eq "flags=.*runtime" <<<"${DETAILS}"; then
  echo "Local ad-hoc builds must not enable hardened runtime." >&2
  exit 1
fi
FRAMEWORK_PATH="${APP_PATH}/Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework"
FRAMEWORK_DETAILS="$(codesign -dvv "${FRAMEWORK_PATH}" 2>&1)"
if ! grep -Fq "Signature=adhoc" <<<"${FRAMEWORK_DETAILS}" || \
  grep -Eq "flags=.*runtime" <<<"${FRAMEWORK_DETAILS}"; then
  echo "Electron Framework does not match the local-only signing policy." >&2
  exit 1
fi
echo "Signed ${APP_PATH} for local testing only"
