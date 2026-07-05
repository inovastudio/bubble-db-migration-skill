# Tools

Runnable CLI implementations of the pipelines the kit's skills describe. All tools are single-file Node.js 18+ ESM scripts with **zero npm dependencies** — no install step; run them directly with `node`.

| Tool | Status | Implements | Skill |
|---|---|---|---|
| [`bubble-export`](bubble-export/) | ✅ ready | Schema discovery, resumable Data API export to NDJSON, incremental sync, deletion sweep | `bubble-db-migration` |
| [`bubble-assets`](bubble-assets/) | 🟡 partial | Asset discovery + URL canonicalization (ready); transfer / rewrite / verify (scaffold) | `bubble-files-migration` |
| [`bubble-load`](bubble-load/) | 🟡 partial | schema.json → Postgres DDL (ready); NDJSON load (scaffold) | `bubble-db-migration` |

Typical flow:

```bash
export BUBBLE_APP_URL=https://myapp.bubbleapps.io BUBBLE_API_TOKEN=...

node tools/bubble-export/bubble-export.mjs discover        # 1. schema plan — review it
node tools/bubble-export/bubble-export.mjs export          # 2. full export (resumable)
node tools/bubble-load/bubble-load.mjs ddl                 # 3. DDL — review, apply
node tools/bubble-assets/bubble-assets.mjs discover        # 4. asset manifest
node tools/bubble-export/bubble-export.mjs sync            # 5. deltas while you build
node tools/bubble-export/bubble-export.mjs sweep           # 6. deletion reconciliation
```

Scaffolded stages print their intended execution plan and exit with code 2; work items are marked `TODO(scaffold):` in the source. Run all tests with:

```bash
node --test tools/bubble-export/test/*.test.mjs tools/bubble-assets/test/*.test.mjs tools/bubble-load/test/*.test.mjs
```

Ground rules for contributing tools are in [CONTRIBUTING.md](../CONTRIBUTING.md).
