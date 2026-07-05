# bubble-load

Turns `bubble-export`'s `schema.json` into Postgres DDL, following the `bubble-db-migration` skill's type-mapping table and load-order rules. Zero-dependency Node.js 18+ CLI.

**Status: partial.** DDL generation is implemented and tested; the load stage is a scaffold that prints its execution plan and exits with code 2.

| Command | Status | What it does |
|---|---|---|
| `ddl` | ✅ implemented | `schema.json` → `schema.sql`: `TEXT PRIMARY KEY` on `_id`, ordered junction tables for lists of Things (with `position`), option-set lookup tables, `_extra JSONB` drift column, `modified_date` index, and FK statements in a trailing **apply-after-load** section |
| `load` | 🚧 scaffold | NDJSON → `COPY`/upsert in the correct order (base → junctions → validate dangling refs → FKs); needs a Postgres driver or `psql \copy`, which is outside the kit's zero-dependency rule |

## Usage

```bash
# After running bubble-export discover:
node bubble-load.mjs ddl --in ./bubble-export-out
# -> ./bubble-export-out/schema.sql — review before applying
```

Reference-typed columns get a `TODO: set target table` comment in the FK section — the Data API can't tell which type a reference points to; confirm targets against your exported data before enabling the constraints.

## Tests

```bash
node --test tools/bubble-load/test/ddl.test.mjs
```

Contributions implementing the `load` stage are welcome — grep for `TODO(scaffold)` and see the `bubble-db-migration` skill §6 for the methodology it must follow.
