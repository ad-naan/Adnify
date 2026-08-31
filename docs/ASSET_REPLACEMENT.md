# Asset Replacement

Brand assets live in `public/brand/`. Replace files in this directory directly; the app, renderer, loader, and installer configuration all read from here.

Authoring originals live in the repository-level `original/` directory. Keep full-resolution source artwork there and export normalized, compressed WebP runtime copies into `public/brand/`; renderer code must not reference `original/`.

## Directory Map

```text
public/brand/
  icons/      App, installer, dock/taskbar, and favicon icons
  logos/      In-app logo images
  ip/         IP character/avatar assets
  welcome/    Startup and welcome-page visual assets

original/
  main.png             Full-resolution brand board
  welcome-*.png        Full-resolution welcome sources
  brand-cropper.html   Local crop/export helper
  otter/
    anchors/           Six full-resolution primary mascot illustrations
    generated/         Retained high-resolution generated originals
    masters/           Lossless PNG masters for shipped WebP assets
```

## Files

### `icons/`

- `app.ico`: Windows app and installer icon.
- `app.icns`: macOS app icon.
- `app.png`: Linux app icon and browser favicon.
- `app-light.ico`, `app-light.icns`, `app-light.png`: light-theme icon variants, reserved for future use.

### `logos/`

- `app.png`: default in-app logo.
- `app-light.png`: logo used by the `dawn` light theme.

### `ip/`

- `1.webp` through `6.webp`: optimized primary mascot illustrations.
- `otter/`: normalized action, body, face, effect, and prop assets used by the renderer.

### `welcome/`

- `loader-logo.png`: logo shown in the initial startup loader.

## Replacement Checklist

1. Export the new design using the same filenames above.
2. Keep icon files square; `1024x1024` PNG is preferred for `app.png`.
3. Keep transparent backgrounds unless the design intentionally needs a solid plate.
4. Run `pnpm build:renderer` after replacing web-facing assets.
5. Run `pnpm dist` when you need to verify installer/app icons.
