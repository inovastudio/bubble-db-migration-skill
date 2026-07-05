# bubble-export

Zero-dependency Node.js CLI that exports a Bubble.io app's database via the **Bubble Data API**. Reference implementation for the `bubble-db-migration` skill — it encodes the skill's extraction pipeline: schema discovery with type inference, resumable cursor-walk exports to NDJSON, Modified Date incremental sync with an overlap window, and ID-sweep deletion reconciliation.

Requires **Node.js 18+**. No `npm install`.

## Quickstart

```bash
export BUBBLE_APP_URL=https://myapp.bubbleapps.io   # or your custom domain
export BUBBLE_API_TOKEN=...                          # ADMIN token (Settings → API)

node bubble-export.mjs discover                      # schema plan → schema.json
node bubble-export.mjs export --limit 500            # small dry run
node bubble-export.mjs export                        # full export (resumable)
node bubble-export.mjs sync                          # deltas since last run
node bubble-export.mjs sweep                         # detect deletions
```

> **Use an admin API token.** A non-admin token silently produces a partial export that looks complete — privacy rules filter what the API returns and the client cannot detect it.

## Commands

| Command | What it does | Key flags |
|---|---|---|
| `discover` | `GET /api/1.1/meta` + samples pages per type; infers field types (references via the Bubble ID pattern, dates, int vs float, option-set heuristic), builds a collision-safe snake_case name map, writes an editable `schema.json` plan | `--sample-pages 3` |
| `export` | Cursor-walks every type (100 records/page, the API cap) to `<type>.ndjson`; checkpoints after every page so a killed job resumes exactly where it stopped; parallel across types, never within a cursor | `--types a,b`, `--limit`, `--since <ISO>`, `--concurrency 3`, `--throttle-ms`, `--no-resume` |
| `sync` | Fetches records with `Modified Date > checkpoint - overlap` into `deltas/<ts>/<type>.ndjson` (upsert input); overlap absorbs clock skew and in-flight writes. Deltas never contain deletions | `--overlap-minutes 5` |
| `sweep` | Walks each type keeping only `_id`, diffs against everything exported so far, writes `deletions/<type>.json`. This is the only way to detect deletions — the Data API has no tombstones | `--concurrency` |

All commands accept `--app`, `--token`, `--out` (default `./bubble-export-out`), `--env test` (Development database via `/version-test`), `--verbose`.

## Output layout

```
bubble-export-out/
├── schema.json              # discover: inferred types, name map, warnings — review and edit
├── <type>.ndjson            # export: one raw Bubble record per line
├── deltas/<ts>/<type>.ndjson# sync runs, kept separate for replayability
├── ids/<type>.ids           # sweep: live IDs
├── deletions/<type>.json    # sweep: IDs missing from Bubble
├── checkpoints/<type>.json  # resume state {cursor, records, lastModified, done}
└── report.json              # requests (WU proxy), retries, 429s, counts — never contains the token
```

## Behavior notes

- **429s**: honors `Retry-After`, else jittered exponential backoff (1s base, ×2, 60s cap, 8 retries). 5xx and network errors retry the same way.
- **404 on a type** → the type doesn't have "Enable Data API" checked, or the name is wrong; the error says so.
- **WU cost**: every request spends the app's workload units; `report.json`'s request count is your spend proxy. Use `--throttle-ms` for a slow overnight mode.
- The tool **never writes to Bubble** — all requests are GETs.

## Tests

```bash
node --test tools/bubble-export/test/
```

Unit tests cover the pure functions (backoff, constraints, type inference, renaming). Integration tests spawn `test/mock-bubble-server.mjs` — a faithful mock of the Data API's pagination/constraint semantics with an injected 429 — and run the real CLI against it, including kill-and-resume, sync, and sweep scenarios.
