---
name: bubble-db-migration
description: Architecture and methodology for migrating a Bubble.io application's database to an external relational database (Postgres, Supabase, MySQL, etc.) via the Bubble Data API, including one-time exports and ongoing incremental sync. Use this skill whenever the user wants to export, extract, migrate, sync, replicate, or back up Bubble data or a Bubble database, move off Bubble, get Bubble data into SQL/Postgres/Supabase, design an ETL pipeline against the Bubble Data API, or asks how to map Bubble data types, lists of things, option sets, or references to a relational schema — even if they don't say "migration" explicitly.
license: MIT
metadata:
  author: inovastudio
  version: "1.0.0"
---

# Bubble Database Migration (Data API → Relational DB)

Methodology for designing and building migrations from Bubble.io databases to external relational databases using the Bubble Data API. Covers full exports, incremental sync, schema mapping, and the failure modes specific to Bubble.

## 1. Data API Constraints (design around these first)

Every design decision below follows from what the Data API does and does not provide:

- **Endpoint**: `GET https://<app>.bubbleapps.io/api/1.1/obj/{typename}` (or the app's custom domain). Cursor-based pagination: `cursor` + `limit` (max 100 records/request). Response contains `results`, `remaining`, `count`.
- **Schema metadata**: `GET /api/1.1/meta` lists exposed types and declared fields — but field typing is coarse. Refine by sampling actual data.
- **Exposure**: only types with "Enable Data API" checked are visible. Detect references to unexposed types and report them explicitly; never silently skip.
- **Auth**: the admin API token bypasses privacy rules and is required for complete exports. A non-admin token yields a *partial export that looks complete* — treat partial mode as an explicit opt-in, never a default.
- **Rate limits**: tied to the app's plan and workload-unit (WU) budget. Extraction consumes the customer's WU; throttling and backoff are mandatory.
- **No deletion tombstones**: deleted records are invisible to delta queries. Deletion detection requires a separate ID-sweep reconciliation.
- **References**: stored as Bubble unique IDs (format like `1699999999999x123456789012345678`). Resolvable, but integrity must be enforced at load time.
- **Option sets**: returned as display values only; the option set definition itself is not exposed.
- **Files/images**: returned as URLs (usually Bubble's S3/CDN). Asset migration is a separate optional stage.

## 2. Pipeline Architecture

Use a five-stage, checkpoint-driven pipeline. Stages communicate through a staging area (raw NDJSON files) so each stage is independently resumable and replayable:

```
Schema Discovery → Extraction → Transformation → Load → Validation
                        │
                   Asset Sync (optional side channel)
```

Core principles:

1. **Keep Bubble unique IDs as primary keys** (`TEXT PRIMARY KEY`). Makes reference resolution trivial, re-runs idempotent, and incremental upserts clean.
2. **Stage raw NDJSON before transforming.** Transformation bugs become replayable without re-hitting Bubble or re-spending WU.
3. **Defer foreign-key constraints until after load.** Applying FKs up front is the classic way these migrations die at 80%.
4. **Checkpoint after every page** so a killed job resumes exactly where it stopped.

## 3. Stage 1 — Schema Discovery & Type Mapping

Merge three sources, in order of authority:

1. `/api/1.1/meta` for the type/field inventory.
2. **Data sampling** (first N pages per type) to refine: integers vs decimals, which text fields are actually references (Bubble ID pattern), option-set fields (low-cardinality repeated strings), list fields.
3. **User overrides** via an editable schema plan. Always emit a reviewable plan with DDL preview and require confirmation before running — never trust inference alone.

Type mapping (Postgres shown; adapt per target):

| Bubble | Target |
|---|---|
| unique id / `_id` | `TEXT PRIMARY KEY` |
| text | `TEXT` |
| number | `NUMERIC` (tighten via sampling) |
| date | `TIMESTAMPTZ` |
| yes/no | `BOOLEAN` |
| reference (Thing) | `TEXT` + FK, validated post-load |
| list of Things | junction table `(parent_id, child_id, position)` — Bubble lists are ordered, preserve position. Arrays only as opt-in |
| list of primitives | native array type |
| option set | `TEXT` + generated lookup table (enum as opt-in) |
| file / image | `TEXT` URL, optionally rewritten after asset sync |
| geographic address | `JSONB` (structured), optional geo point |
| Created/Modified Date, Created By, Slug | regular columns; **index `Modified Date`** (drives incremental sync) |

Field names: normalize display names to snake_case with a deterministic, collision-safe renamer; record the name map in the plan. Expect pathological names (duplicates, emoji, SQL reserved words).

## 4. Stage 2 — Extraction

- One cursor walker per type (`cursor += count` until `remaining = 0`). Parallelize **across types**, not within a cursor. Default modest concurrency (3–4) to respect WU budgets; expose a throttle knob.
- Adaptive backoff on 429s and timeouts.
- For very large types, slice by `Created Date` ranges using the `constraints` query parameter — enables intra-type parallelism and bounds failure blast radius.
- Persist `{type, cursor, lastCreatedDate}` checkpoints per page.
- Write raw pages as NDJSON before any transformation (audit trail + replay).

## 5. Stage 3 — Transformation

Per record, against staged NDJSON:

1. Apply the field name map.
2. Pass reference IDs through unchanged, but log every referenced ID to a **dangling-reference ledger**. References to records never returned (privacy-hidden, deleted, unexposed type) get resolved per policy: null out, keep with FK disabled, or fail.
3. Explode list-of-Things fields into junction rows with position.
4. Accumulate distinct option-set values into lookup tables.
5. Append file/image URLs to an asset manifest for the optional asset-sync stage.
6. Route unknown/unexpected fields (schema drift mid-run) into an `_extra JSONB` column rather than failing; schema is snapshotted at plan time.

## 6. Stage 4 — Load

- Bulk-load initial migration via the target's fastest path (e.g., Postgres `COPY`); use upserts keyed on `_id` for incremental sync.
- Load order: base tables (FKs deferred) → junction tables → validate dangling references → apply FK constraints last.
- Target-specific extras where relevant (e.g., Supabase: RLS policy scaffolding as a starting point for re-implementing Bubble privacy rules, Storage as the asset target).

## 7. Incremental Sync

- Delta query per type: `constraints=[{"key":"Modified Date","constraint_type":"greater than","value":<last_sync>}]`, sorted by Modified Date; upsert results.
- **Overlap window**: re-fetch a few minutes before `last_sync` to absorb clock skew and in-flight writes.
- **Deletion reconciliation** (no tombstones exist): scheduled sweep paging through each type fetching only `_id`, diffed against the target; soft-delete (`_deleted_at`) or hard-delete per policy. WU-cheap relative to full extraction; run nightly or on demand.
- This mode enables gradual migration: Bubble remains source of truth while the new backend is built against the synced copy, then cut over.

## 8. Stage 5 — Validation

- Row counts per type (Bubble `remaining + count` math vs target `COUNT(*)`).
- Spot checksums: sample K records per type, re-fetch from Bubble by ID, deep-compare post-transformation.
- Dangling-reference summary and applied policies.
- Emit a migration report: counts, durations, estimated WU consumed, warnings, unexposed types detected.

## 9. Risks & Edge Cases Checklist

Always assess these when designing or reviewing a Bubble migration:

1. **Unexposed types** — dangling references reveal them; the fix is "enable Data API on type X and re-run", say so explicitly.
2. **Partial exports from non-admin tokens** — look complete but aren't; require admin token by default.
3. **Schema drift mid-extraction** — snapshot schema at plan time, `_extra JSONB` for surprises.
4. **WU cost** — estimate at plan time and surface it before running; offer slow overnight mode.
5. **Field name pathologies** — deterministic renamer + recorded name map.
6. **Very large text fields** — Bubble stores multi-MB text; watch target row-size and index limits.
7. **Ordered lists** — junction tables must preserve `position`; Bubble list order is often semantically meaningful.
8. **Deletions** — never claim sync completeness without an ID-sweep reconciliation strategy.

## 10. How to Apply This Skill

- If the user wants a **one-time export**: run stages 1–5, skip section 7.
- If the user wants **ongoing sync / gradual migration**: full pipeline plus section 7; deletion reconciliation is not optional.
- If the user asks **schema-mapping questions only**: use sections 3 and 9.
- Always produce a reviewable migration plan (schema + DDL + WU estimate) before any extraction begins, and get user confirmation.
