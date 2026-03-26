#!/usr/bin/env bash
set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DESKTOP_DIR"

APP_NAME="$(node -e "console.log(JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')).package.productName)")"
PRODUCT_NAME="${DMG_PRODUCT_NAME:-$APP_NAME}"
VOL_NAME="${DMG_VOLUME_NAME:-$PRODUCT_NAME Installer}"
WINDOW_WIDTH="${DMG_WINDOW_WIDTH:-720}"
WINDOW_HEIGHT="${DMG_WINDOW_HEIGHT:-460}"
ICON_SIZE="${DMG_ICON_SIZE:-128}"
TEXT_SIZE="${DMG_TEXT_SIZE:-14}"
APP_ICON_X="${DMG_APP_ICON_X:-190}"
APP_ICON_Y="${DMG_APP_ICON_Y:-250}"
APPS_ICON_X="${DMG_APPS_ICON_X:-530}"
APPS_ICON_Y="${DMG_APPS_ICON_Y:-250}"
WINDOW_LEFT=100
WINDOW_TOP=100
WINDOW_RIGHT=$((WINDOW_LEFT + WINDOW_WIDTH))
WINDOW_BOTTOM=$((WINDOW_TOP + WINDOW_HEIGHT))

SIGN_IDENTITY="${APPLE_SIGN_IDENTITY-}"
ENABLE_CODESIGN="${ENABLE_CODESIGN:-1}"
ENABLE_NOTARIZE="${ENABLE_NOTARIZE:-auto}"
ENABLE_DMG_UI_LAYOUT="${ENABLE_DMG_UI_LAYOUT:-1}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"
APPLE_ID="${APPLE_ID:-}"
APPLE_APP_SPECIFIC_PASSWORD="${APPLE_APP_SPECIFIC_PASSWORD:-}"
APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"

find_developer_id_identity() {
  security find-identity -v -p codesigning 2>/dev/null \
    | awk -F'"' '/Developer ID Application:/{ print $2; exit }' \
    | head -n 1
}

trim() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

is_developer_id_identity() {
  local identity
  identity="$(trim "${1:-}")"
  [[ "$identity" == Developer\ ID\ Application:* ]]
}

has_notary_credentials() {
  [[ -n "$(trim "$NOTARY_PROFILE")" ]] || {
    [[ -n "$(trim "$APPLE_ID")" && -n "$(trim "$APPLE_APP_SPECIFIC_PASSWORD")" && -n "$(trim "$APPLE_TEAM_ID")" ]]
  }
}

submit_for_notarization() {
  local target="$1"
  if [[ -n "$(trim "$NOTARY_PROFILE")" ]]; then
    xcrun notarytool submit "$target" --keychain-profile "$NOTARY_PROFILE" --wait
    return
  fi

  xcrun notarytool submit \
    "$target" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait
}

if [[ -z "$(trim "$SIGN_IDENTITY")" ]]; then
  AUTO_DETECTED_IDENTITY="$(find_developer_id_identity)"
  if [[ -n "$AUTO_DETECTED_IDENTITY" ]]; then
    SIGN_IDENTITY="$AUTO_DETECTED_IDENTITY"
  else
    SIGN_IDENTITY="-"
  fi
fi

SIGN_MODE="adhoc"
if is_developer_id_identity "$SIGN_IDENTITY"; then
  SIGN_MODE="developer-id"
fi

NOTARIZE_MODE="disabled"
case "$ENABLE_NOTARIZE" in
  1|true|TRUE|yes|YES)
    NOTARIZE_MODE="required"
    ;;
  auto|AUTO|"")
    if has_notary_credentials; then
      NOTARIZE_MODE="auto"
    fi
    ;;
  0|false|FALSE|no|NO)
    NOTARIZE_MODE="disabled"
    ;;
  *)
    echo "Unsupported ENABLE_NOTARIZE value: $ENABLE_NOTARIZE" >&2
    exit 1
    ;;
esac

if [[ "$NOTARIZE_MODE" != "disabled" && "$SIGN_MODE" != "developer-id" ]]; then
  if [[ "$NOTARIZE_MODE" == "required" ]]; then
    echo "Notarization requires a Developer ID Application identity. Current identity: ${SIGN_IDENTITY:-<none>}" >&2
    exit 1
  fi
  echo "Notarization skipped: Developer ID Application identity not available."
  NOTARIZE_MODE="disabled"
fi

if [[ "$NOTARIZE_MODE" != "disabled" && "$ENABLE_CODESIGN" != "1" ]]; then
  if [[ "$NOTARIZE_MODE" == "required" ]]; then
    echo "Notarization requires codesigning. ENABLE_CODESIGN must be 1." >&2
    exit 1
  fi
  echo "Notarization skipped: ENABLE_CODESIGN is disabled."
  NOTARIZE_MODE="disabled"
fi

if [[ "$NOTARIZE_MODE" != "disabled" ]] && ! has_notary_credentials; then
  if [[ "$NOTARIZE_MODE" == "required" ]]; then
    echo "Notarization requested but credentials are missing. Provide NOTARY_PROFILE or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID." >&2
    exit 1
  fi
  echo "Notarization skipped: credentials are missing."
  NOTARIZE_MODE="disabled"
fi

echo "Building macOS app bundle..."
npm run prepare:kernel

TAURI_BIN="$DESKTOP_DIR/node_modules/.bin/tauri"
if [[ -x "$TAURI_BIN" ]]; then
  "$TAURI_BIN" build --bundles app
else
  echo "Local tauri CLI not found at $TAURI_BIN, fallback to npm exec..." >&2
  npm exec -- tauri build --bundles app
fi

APP_BUNDLE_NAME="$APP_NAME.app"
APP_PATH="$DESKTOP_DIR/src-tauri/target/release/bundle/macos/$APP_BUNDLE_NAME"
if [[ ! -d "$APP_PATH" ]]; then
  echo "App bundle not found: $APP_PATH" >&2
  exit 1
fi

if [[ "$ENABLE_CODESIGN" == "1" ]]; then
  echo "Signing app bundle (identity: $SIGN_IDENTITY, mode: $SIGN_MODE)..."
  CODESIGN_APP_ARGS=(--force --deep --sign "$SIGN_IDENTITY")
  if [[ "$SIGN_MODE" == "developer-id" ]]; then
    CODESIGN_APP_ARGS+=(--options runtime --timestamp)
  fi
  codesign "${CODESIGN_APP_ARGS[@]}" "$APP_PATH"
  codesign --verify --deep --strict --verbose=2 "$APP_PATH"
  if [[ "$SIGN_MODE" == "adhoc" ]]; then
    echo "Warning: ad-hoc signing only. Public distribution should use Developer ID + notarization."
  fi
fi

if [[ "$NOTARIZE_MODE" != "disabled" ]]; then
  echo "Submitting app bundle for notarization..."
  submit_for_notarization "$APP_PATH"
  echo "Stapling app bundle notarization ticket..."
  xcrun stapler staple "$APP_PATH"
  echo "App bundle notarized."
fi
if [[ "$ENABLE_CODESIGN" == "1" && "$SIGN_MODE" == "developer-id" ]]; then
  if ! spctl -a -t exec -vv "$APP_PATH" >/dev/null 2>&1; then
    echo "Warning: spctl rejected app bundle before/without Gatekeeper context. Continue with DMG packaging."
  fi
fi

VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")"

ARCH_RAW="$(uname -m)"
case "$ARCH_RAW" in
  arm64|aarch64) ARCH="aarch64" ;;
  x86_64|amd64) ARCH="x64" ;;
  *) ARCH="$ARCH_RAW" ;;
esac

OUT_DIR="$DESKTOP_DIR/src-tauri/target/release/bundle/dmg"
mkdir -p "$OUT_DIR"
ARTIFACT_BASENAME="${APP_NAME// /_}_${VERSION}_${ARCH}"
OUT_PATH="$OUT_DIR/$ARTIFACT_BASENAME.dmg"
RW_DMG_PATH="$OUT_DIR/$ARTIFACT_BASENAME-rw.dmg"

STAGING_DIR="$(mktemp -d "$OUT_DIR/staging.XXXXXX")"
MOUNT_DIR="/Volumes/$VOL_NAME"
DEVICE=""
create_plain_dmg() {
  echo "Creating fallback DMG without Finder layout customization..."
  rm -f "$OUT_PATH"
  hdiutil create \
    -volname "$VOL_NAME" \
    -srcfolder "$STAGING_DIR" \
    -ov \
    -format UDZO \
    -imagekey zlib-level=9 \
    "$OUT_PATH" >/dev/null
}

detach_device() {
  local target="$1"
  local mounted_path="${2:-}"
  if [[ -z "$target" ]]; then
    return 0
  fi

  if [[ -n "$mounted_path" && -d "$mounted_path" ]]; then
    osascript >/dev/null 2>&1 <<EOF || true
tell application "Finder"
  try
    eject disk "$(basename "$mounted_path")"
  end try
end tell
EOF
  fi

  for _ in {1..8}; do
    if hdiutil detach "$target" >/dev/null 2>&1; then
      return 0
    fi
    sync
    sleep 1
  done

  hdiutil detach "$target" -force >/dev/null 2>&1
}
cleanup() {
  if [[ -n "${DEVICE:-}" ]]; then
    detach_device "$DEVICE" "$MOUNT_DIR" || true
  fi
  rm -rf "$STAGING_DIR"
  rm -f "$RW_DMG_PATH"
}
trap cleanup EXIT

mkdir -p "$STAGING_DIR/.background"
swift "$DESKTOP_DIR/scripts/render-dmg-background.swift" \
  "$STAGING_DIR/.background/background.png" \
  "$PRODUCT_NAME" \
  "$DESKTOP_DIR/src-tauri/icons/icon-512.png" \
  "$WINDOW_WIDTH" \
  "$WINDOW_HEIGHT"

ditto "$APP_PATH" "$STAGING_DIR/$APP_BUNDLE_NAME"
ln -s /Applications "$STAGING_DIR/Applications"
chflags hidden "$STAGING_DIR/.background"

echo "Creating writable DMG..."
hdiutil create \
  -volname "$VOL_NAME" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDRW \
  "$RW_DMG_PATH" >/dev/null

if [[ -d "$MOUNT_DIR" ]]; then
  echo "Detaching existing mounted volume at $MOUNT_DIR..."
  hdiutil detach "$MOUNT_DIR" -force >/dev/null 2>&1 || true
  sleep 1
fi

echo "Attaching writable DMG..."
DEVICE="$(hdiutil attach \
  -readwrite \
  -noverify \
  -noautoopen \
  "$RW_DMG_PATH" | awk '/^\/dev\// { print $1; exit }')"

if [[ -z "$DEVICE" ]]; then
  echo "Failed to attach DMG: $RW_DMG_PATH" >&2
  exit 1
fi

for _ in {1..10}; do
  if [[ -d "$MOUNT_DIR" ]]; then
    break
  fi
  sleep 1
done

if [[ ! -d "$MOUNT_DIR" ]]; then
  echo "Mounted volume path not found: $MOUNT_DIR" >&2
  exit 1
fi

LAYOUT_OK=0
if [[ "$ENABLE_DMG_UI_LAYOUT" == "1" ]]; then
osascript <<EOF || true
set bgAlias to POSIX file "$MOUNT_DIR/.background/background.png" as alias

tell application "Finder"
  tell disk "$VOL_NAME"
    open
    delay 2
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set the bounds of container window to {$WINDOW_LEFT, $WINDOW_TOP, $WINDOW_RIGHT, $WINDOW_BOTTOM}
    set opts to the icon view options of container window
    set arrangement of opts to not arranged
    set icon size of opts to $ICON_SIZE
    set text size of opts to $TEXT_SIZE
    set background picture of opts to bgAlias
    set position of item "$APP_BUNDLE_NAME" of container window to {$APP_ICON_X, $APP_ICON_Y}
    set position of item "Applications" of container window to {$APPS_ICON_X, $APPS_ICON_Y}
    update without registering applications
    delay 2
    close
    open
    update without registering applications
    delay 2
  end tell
end tell
EOF

  bless --folder "$MOUNT_DIR" --openfolder "$MOUNT_DIR" >/dev/null 2>&1 || true
  sync
  sleep 1
  if detach_device "$DEVICE" "$MOUNT_DIR"; then
    DEVICE=""
    echo "Converting DMG..."
    rm -f "$OUT_PATH"
    hdiutil convert "$RW_DMG_PATH" -format UDZO -imagekey zlib-level=9 -o "$OUT_PATH" >/dev/null
    LAYOUT_OK=1
  else
    echo "Warning: custom Finder layout failed; falling back to plain DMG." >&2
  fi
fi

if [[ "$LAYOUT_OK" != "1" ]]; then
  if [[ -n "${DEVICE:-}" ]]; then
    detach_device "$DEVICE" "$MOUNT_DIR" || true
    DEVICE=""
  fi
  create_plain_dmg
fi

if [[ "$ENABLE_CODESIGN" == "1" ]]; then
  echo "Signing DMG (identity: $SIGN_IDENTITY, mode: $SIGN_MODE)..."
  CODESIGN_DMG_ARGS=(--force --sign "$SIGN_IDENTITY")
  if [[ "$SIGN_MODE" == "developer-id" ]]; then
    CODESIGN_DMG_ARGS+=(--timestamp)
  fi
  codesign "${CODESIGN_DMG_ARGS[@]}" "$OUT_PATH"
fi

if [[ "$NOTARIZE_MODE" != "disabled" ]]; then
  echo "Submitting DMG for notarization..."
  submit_for_notarization "$OUT_PATH"
  echo "Stapling notarization ticket..."
  xcrun stapler staple "$OUT_PATH"
fi

echo "DMG created: $OUT_PATH"
