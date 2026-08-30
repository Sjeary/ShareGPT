#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
manifest="$project_root/build/bin/checksums.json"
output_dir="${1:-$project_root/build/bin}"
version="$(node -p "require('$manifest')['sing-box'].macos.version")"
archive_sha256="$(node -p "require('$manifest')['sing-box'].macos.archiveSha256")"
binary_sha256="$(node -p "require('$manifest')['sing-box'].macos.sha256")"
archive_name="sing-box-${version}-darwin-arm64.tar.gz"
archive_url="https://github.com/SagerNet/sing-box/releases/download/v${version}/${archive_name}"
temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/sharegpt-macos-assets.XXXXXX")"
trap 'rm -rf "$temporary_dir"' EXIT

if [[ -n "${SHAREGPT_MACOS_ASSET_ARCHIVE:-}" ]]; then
  if [[ ! -f "$SHAREGPT_MACOS_ASSET_ARCHIVE" ]]; then
    echo "SHAREGPT_MACOS_ASSET_ARCHIVE does not exist: $SHAREGPT_MACOS_ASSET_ARCHIVE" >&2
    exit 1
  fi
  cp "$SHAREGPT_MACOS_ASSET_ARCHIVE" "$temporary_dir/$archive_name"
else
  curl --fail --location --silent --show-error \
    --retry 3 --retry-delay 2 --retry-all-errors \
    "$archive_url" -o "$temporary_dir/$archive_name"
fi

actual_archive_sha256="$(shasum -a 256 "$temporary_dir/$archive_name" | awk '{print $1}')"
if [[ "$actual_archive_sha256" != "$archive_sha256" ]]; then
  echo "sing-box archive SHA-256 mismatch: expected $archive_sha256, got $actual_archive_sha256" >&2
  exit 1
fi

tar -xzf "$temporary_dir/$archive_name" -C "$temporary_dir"
source_binary="$temporary_dir/sing-box-${version}-darwin-arm64/sing-box"
if [[ ! -f "$source_binary" ]]; then
  echo "sing-box archive is incomplete" >&2
  exit 1
fi
actual_binary_sha256="$(shasum -a 256 "$source_binary" | awk '{print $1}')"
if [[ "$actual_binary_sha256" != "$binary_sha256" ]]; then
  echo "sing-box binary SHA-256 mismatch: expected $binary_sha256, got $actual_binary_sha256" >&2
  exit 1
fi

mkdir -p "$output_dir"
install -m 0755 "$source_binary" "$output_dir/sing-box"
echo "Prepared sing-box v${version} for macOS arm64 with verified archive and binary digests."
