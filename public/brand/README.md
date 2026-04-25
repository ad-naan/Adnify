# Brand Assets

This folder separates source-like internal assets from generated platform assets.

## Internal App Assets

- `logos/app.png`: dark-theme in-app logo source.
- `logos/app-light.png`: light-theme in-app logo source.
- `welcome/dark.webp`: dark welcome illustration.
- `welcome/light.webp`: light welcome illustration.
- `ip/ai-avatar.gif`: in-app assistant/avatar asset.

These are referenced by renderer UI and loading screens.

## System / Platform Icons

- `icons/app.ico`: Windows app/installer icon.
- `icons/app.icns`: macOS app icon.
- `icons/app.png`: Linux app icon and browser favicon source.
- `icons/sizes/app/*.png`: generated PNG sizes for the default system icon.

The default system icon is generated from `logos/app-light.png`, so Dock, taskbar, installer, and Linux icons use the light logo artwork.

Optional dark-logo icon outputs live under:

- `icons/variants/app-dark/`
- `icons/sizes/app-dark/`

Operating systems generally do not auto-switch Electron app icons by light/dark mode. The root `icons/app.*` files are the default universal system icons used by the package config.

## Regeneration

Run:

```bash
npm run assets:icons
```

The script generates lossless PNG outputs plus `.ico` and `.icns`. Root `icons/app.*` outputs are generated from `logos/app-light.png`.
