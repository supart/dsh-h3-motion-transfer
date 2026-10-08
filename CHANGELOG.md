# Changelog

## 1.2.0

- `assets/tools/lib/resolve-bin.mjs`: binary resolution now also probes the npm
  packages `@ffmpeg-installer/ffmpeg` and `ffmpeg-static` (and the ffprobe
  equivalents), so an install can carry the binaries itself.
- `assets/tools/lib/resolve-bin.mjs`: `drawtext` font is chosen per platform
  (Windows Arial/Segoe UI, macOS Arial/Helvetica, Linux DejaVu/Liberation) and
  falls back to ffmpeg's own default font instead of failing the filter.
- `--doctor` now reports the resolved font and the plugin version, and warns when
  an ffmpeg build is missing `drawtext` or `tile`.
- New `assets/tools/prefetch-ffmpeg.mjs`: one-time fetch of ffmpeg/ffprobe into
  `assets/tools/vendor/bin/<platform>-<arch>/`, trying a mirror, gyan.dev, BtbN
  nightly builds, then npm packages; honours `HTTPS_PROXY`; never fails an install.
- New `assets/tools/check.mjs` and the `dsh-h3-motion-check` bin entry: prints
  version, font, binary sources and filter availability, exit code 1 when a
  binary is missing.
- `package.json` is now publishable (exports/files/bin/engines/license/keywords).
- `assets/SKILL.md`: working procedure documents the binary resolution chain and
  the cut-candidate command; new "Troubleshooting the tools" section.
- `assets/tools/frames.mjs`: refuses to reuse a non-empty `--out` folder unless
  `--force` is passed, and reports `lastSampledTimestamp` / `coverageComplete`.
- `assets/tools/verify-sheets.mjs`: overview step auto-fits the 4x6 grid, the
  manifest records `shot_count` / `boundary_sheets` / `cut_times`, and a
  single-shot clip exports successfully with `boundary_sheets: 0`.

## 1.1.0

- Plugin publishes the `h3-compact-motion-transfer` skill through the DSH skills
  registry (`inject = ['skills']`), with the six-section Ref2VA prompt contract.
- Ships `assets/tools/frames.mjs` and `assets/tools/verify-sheets.mjs`.
- Upstream V3 skill text kept in sync, plus the validated intake, identity-anchor,
  prop-ownership, fresh-extraction and process-mosaic rules.
