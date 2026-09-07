#!/bin/bash
# Builds the "Dots & Squares" desktop app bundle from the rendered icon PNG.
# Run `node scripts/make-icon.mjs` first, or use `npm run make-icon` for both.
set -e

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
PNG="$PROJECT/.playwright-shots/icon-1024.png"
SET="$PROJECT/.playwright-shots/icon.iconset"
ICNS="$PROJECT/.playwright-shots/DotsAndSquares.icns"
APP="$HOME/Desktop/Dots & Squares.app"

[ -f "$PNG" ] || { echo "Missing $PNG — run: node scripts/make-icon.mjs"; exit 1; }

rm -rf "$SET"; mkdir -p "$SET"
sips -z 16 16   "$PNG" --out "$SET/icon_16x16.png"      >/dev/null
sips -z 32 32   "$PNG" --out "$SET/icon_16x16@2x.png"   >/dev/null
sips -z 32 32   "$PNG" --out "$SET/icon_32x32.png"      >/dev/null
sips -z 64 64   "$PNG" --out "$SET/icon_32x32@2x.png"   >/dev/null
sips -z 128 128 "$PNG" --out "$SET/icon_128x128.png"    >/dev/null
sips -z 256 256 "$PNG" --out "$SET/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$PNG" --out "$SET/icon_256x256.png"    >/dev/null
sips -z 512 512 "$PNG" --out "$SET/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$PNG" --out "$SET/icon_512x512.png"    >/dev/null
cp "$PNG" "$SET/icon_512x512@2x.png"
iconutil -c icns "$SET" -o "$ICNS"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ICNS" "$APP/Contents/Resources/AppIcon.icns"
cp "$PROJECT/scripts/launcher.sh" "$APP/Contents/MacOS/launch"
chmod +x "$APP/Contents/MacOS/launch"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Dots &amp; Squares</string>
  <key>CFBundleDisplayName</key><string>Dots &amp; Squares</string>
  <key>CFBundleIdentifier</key><string>local.dots-and-squares.launcher</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <!-- Background agent: no Dock icon while the server runs, so it never looks
       like a stuck app. Double-clicking the icon again offers to stop it. -->
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

touch "$APP"   # nudge Finder to pick up the new icon
echo "Built: $APP"
