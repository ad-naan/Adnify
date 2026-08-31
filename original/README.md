# Authoring originals

This directory is intentionally outside `public/` and is not included in the packaged application.

- `main.png`, `welcome-dark.png`, and `welcome-light.png` are full-resolution brand and welcome sources.
- `brand-cropper.html` is the local crop/export helper for `main.png`.
- `otter/anchors/` contains the six full-resolution primary mascot illustrations.
- `otter/generated/` contains the retained high-resolution ImageGen originals that have an active runtime derivative.
- `otter/masters/` contains the normalized lossless PNG masters for every shipped action, body, face, effect, and prop.
- `otter/animated/` contains retired animation sources retained only for future authoring or re-encoding.

Renderer code must never reference this directory. Export UI-ready WebP files to `public/brand/ip/` and keep filenames synchronized through `src/renderer/components/brand/otterAssets.ts`.
