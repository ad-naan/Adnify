# Asset Replacement

Brand assets live in `public/brand/`. Replace files in this directory directly; the app, renderer, loader, and installer configuration all read from here.

## Directory Map

```text
public/brand/
  icons/      App, installer, dock/taskbar, and favicon icons
  logos/      In-app logo images
  ip/         IP character/avatar assets
  welcome/    Startup and welcome-page visual assets
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

- `ai-avatar.gif`: assistant/IP avatar used in chat surfaces.

### `welcome/`

- `loader-logo.png`: logo shown in the initial startup loader.

## Replacement Checklist

1. Export the new design using the same filenames above.
2. Keep icon files square; `1024x1024` PNG is preferred for `app.png`.
3. Keep transparent backgrounds unless the design intentionally needs a solid plate.
4. Run `npm run build:renderer` after replacing web-facing assets.
5. Run `npm run dist` when you need to verify installer/app icons.
