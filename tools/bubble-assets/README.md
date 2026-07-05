# bubble-assets

Asset-migration companion to the `bubble-files-migration` skill. Zero-dependency Node.js 18+ CLI.

**Status: partial.** Discovery and URL canonicalization are implemented and tested; the network/DB stages are scaffolds that print their execution plan and exit with code 2.

| Command | Status | What it does |
|---|---|---|
| `discover` | ✅ implemented | Scans `bubble-export` NDJSON output (all string fields, including rich-text BBCode `[img]` embeds, and `deltas/` runs) for Bubble-hosted asset URLs; canonicalizes across all four URL shapes (protocol-relative S3, absolute S3, CDN/imgix-wrapped, `<appid>.cdn.bubble.io`); dedupes; writes `asset-manifest.json` |
| `transfer` | 🚧 scaffold | Streaming download → upload to Supabase Storage / R2 / S3 with a URL-map checkpoint table |
| `rewrite` | 🚧 scaffold | Rewrites asset URLs in the migrated database (never writes back to Bubble) |
| `verify` | 🚧 scaffold | Count funnel, checksum spot checks, residual-URL grep |

## Usage

```bash
# After running bubble-export:
node bubble-assets.mjs discover --in ./bubble-export-out
# -> ./bubble-export-out/asset-manifest.json + a discovery report
```

The discovery report notes that editor-uploaded static assets (logos, backgrounds) never appear in the database — enumerate those manually from the Bubble editor.

> **Timing warning** (also printed by the `transfer` scaffold): Bubble deletes an app's files when the app is closed or downgraded. Complete asset transfer **before** decommissioning the Bubble app.

## Tests

```bash
node --test tools/bubble-assets/test/canonicalize.test.mjs
```

Contributions implementing the scaffolded stages are welcome — grep for `TODO(scaffold)` and see the `bubble-files-migration` skill for the full methodology each stage must follow.
