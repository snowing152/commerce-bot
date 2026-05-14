# Coupang Bot — App Icon Build Pipeline

Drop the contents of this folder into your electron-vite project root. electron-builder picks them up from `build/` by default — no `package.json` changes needed.

## What's here

```
build/
├── icon.svg              # Master (1024×1024 viewBox, gradient, full detail)
├── icon-small.svg        # Optimized for ≤32px (thicker strokes, larger dot)
├── icon.png              # 512×512 PNG — Linux default
└── icons/
    ├── 16x16.png         # Favicon / Windows taskbar small
    ├── 24x24.png         # Windows taskbar
    ├── 32x32.png         # Windows tray + favicon @2x
    ├── 48x48.png         # Windows shell
    ├── 64x64.png
    ├── 96x96.png
    ├── 128x128.png       # macOS standard
    ├── 256x256.png       # Windows Vista+
    ├── 512x512.png       # Linux + macOS retina
    └── 1024x1024.png     # macOS master
```

## Generating `icon.ico` (Windows) and `icon.icns` (macOS)

These are container formats — generate them once from the PNGs above and check them into `build/`. electron-builder will then use them automatically.

### Option A — One-shot (recommended)

```bash
# Cross-platform: uses the PNGs in build/icons/
npx electron-icon-builder --input=build/icon.png --output=build --flatten
# → produces build/icon.ico, build/icon.icns, build/icons/*
```

### Option B — Manual

**Windows `.ico`** (bundles 16, 24, 32, 48, 64, 128, 256 px):
```bash
# requires ImageMagick
magick build/icons/16x16.png build/icons/24x24.png build/icons/32x32.png \
       build/icons/48x48.png build/icons/64x64.png build/icons/128x128.png \
       build/icons/256x256.png build/icon.ico
```

**macOS `.icns`** (bundles 16…1024):
```bash
# macOS only — uses Apple's iconutil
mkdir build/icon.iconset
cp build/icons/16x16.png    build/icon.iconset/icon_16x16.png
cp build/icons/32x32.png    build/icon.iconset/icon_16x16@2x.png
cp build/icons/32x32.png    build/icon.iconset/icon_32x32.png
cp build/icons/64x64.png    build/icon.iconset/icon_32x32@2x.png
cp build/icons/128x128.png  build/icon.iconset/icon_128x128.png
cp build/icons/256x256.png  build/icon.iconset/icon_128x128@2x.png
cp build/icons/256x256.png  build/icon.iconset/icon_256x256.png
cp build/icons/512x512.png  build/icon.iconset/icon_256x256@2x.png
cp build/icons/512x512.png  build/icon.iconset/icon_512x512.png
cp build/icons/1024x1024.png build/icon.iconset/icon_512x512@2x.png
iconutil -c icns build/icon.iconset -o build/icon.icns
```

## electron-builder config

In your `electron-builder.yml` (or `package.json` → `"build"`):

```yaml
appId: com.coupangbot.app
productName: Coupang Bot
directories:
  buildResources: build
win:
  icon: build/icon.ico
  target: [nsis]
mac:
  icon: build/icon.icns
  target: [dmg]
linux:
  icon: build/icon.png
  target: [AppImage, deb]
```

## Renderer references

Browser favicon / in-app references:

```html
<link rel="icon" type="image/svg+xml" href="/build/icon.svg" />
<link rel="icon" type="image/png" sizes="32x32" href="/build/icons/32x32.png" />
```

For the dashboard top-bar wordmark and auth page logo, import `icon.svg` directly as a React component (via `vite-plugin-svgr`) so the bracket strokes stay vector at any zoom.
