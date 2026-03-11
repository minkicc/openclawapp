#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SIGN_IDENTITY="${APPLE_SIGN_IDENTITY:--}"
ENABLE_CODESIGN="${ENABLE_CODESIGN:-1}"
ENABLE_NOTARIZE="${ENABLE_NOTARIZE:-0}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"

echo "Building macOS app bundle..."
npm run prepare:kernel
npx tauri build --bundles app

APP_PATH="$ROOT_DIR/src-tauri/target/release/bundle/macos/OpenClaw.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "App bundle not found: $APP_PATH" >&2
  exit 1
fi

if [[ "$ENABLE_CODESIGN" == "1" ]]; then
  echo "Signing app bundle (identity: $SIGN_IDENTITY)..."
  codesign --force --deep --sign "$SIGN_IDENTITY" "$APP_PATH"
  codesign --verify --deep --strict --verbose=2 "$APP_PATH"
  if [[ "$SIGN_IDENTITY" == "-" ]]; then
    echo "Warning: ad-hoc signing only. Public distribution should use Developer ID + notarization."
  fi
fi

VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")"

ARCH_RAW="$(uname -m)"
case "$ARCH_RAW" in
  arm64|aarch64) ARCH="aarch64" ;;
  x86_64|amd64) ARCH="x64" ;;
  *) ARCH="$ARCH_RAW" ;;
esac

OUT_DIR="$ROOT_DIR/src-tauri/target/release/bundle/dmg"
mkdir -p "$OUT_DIR"
OUT_PATH="$OUT_DIR/OpenClaw_${VERSION}_${ARCH}.dmg"

STAGING_DIR="$(mktemp -d "$OUT_DIR/staging.XXXXXX")"
cleanup() {
  rm -rf "$STAGING_DIR"
}
trap cleanup EXIT

cp -R "$APP_PATH" "$STAGING_DIR/"
ln -s /Applications "$STAGING_DIR/Applications"

echo "Creating DMG..."
hdiutil create -volname "OpenClaw Installer" -srcfolder "$STAGING_DIR" -ov -format UDZO "$OUT_PATH" >/dev/null

if [[ "$ENABLE_CODESIGN" == "1" ]]; then
  echo "Signing DMG (identity: $SIGN_IDENTITY)..."
  codesign --force --sign "$SIGN_IDENTITY" "$OUT_PATH"
fi

if [[ "$ENABLE_NOTARIZE" == "1" ]]; then
  if [[ -z "$NOTARY_PROFILE" ]]; then
    echo "NOTARY_PROFILE is required when ENABLE_NOTARIZE=1" >&2
    exit 1
  fi
  echo "Submitting DMG for notarization..."
  xcrun notarytool submit "$OUT_PATH" --keychain-profile "$NOTARY_PROFILE" --wait
  echo "Stapling notarization ticket..."
  xcrun stapler staple "$OUT_PATH"
fi

echo "DMG created: $OUT_PATH"
