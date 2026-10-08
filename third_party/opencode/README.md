# OpenCode themes

Original theme JSON files and the two color resolvers from [anomalyco/opencode](https://github.com/anomalyco/opencode), pinned to commit `3f393d78bfc3f0826b2c7080e57964c235704695`.

These sources are kept unchanged under the upstream MIT license in `LICENSE`. `SOURCE.json` records each theme's SHA-256 hash. Both light and dark variants and all upstream token overrides are preserved.

`npm run themes:sync` fetches that pinned revision and generates `src/themes/catalog.json`. `npm run themes:check` uses only these local source files to verify that the generated catalog exactly matches the original resolvers. Normal application builds require no connection to GitHub.

OCC uses the semantic background, surface, text, border, button, icon, Markdown and diff tokens throughout its mobile interface. Appearance preferences are stored locally, including the optional system light/dark mode.
