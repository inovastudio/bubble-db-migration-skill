---
name: bubble-files-migration
description: Methodology for migrating files and images hosted on Bubble.io's storage (Bubble's S3 / appforest_uf / Bubble CDN) to external object storage (Supabase Storage, Cloudflare R2, own S3), including discovery from a migrated database, download/upload pipelines, and rewriting file URLs in the migrated data. Use this skill whenever the user wants to export, download, migrate, or back up Bubble files, images, or uploads, move assets off Bubble's S3 or CDN, rewrite appforest_uf URLs, or handle Bubble private files — even if they don't say "migration" explicitly.
license: MIT
metadata:
  author: inovastudio
  version: "1.1.0"
---

# Bubble Files & Asset Migration (Bubble Storage → External Object Storage)

Methodology for moving files and images off Bubble.io's storage into external object storage, and rewriting the URLs in the migrated database. Covers URL discovery and canonicalization, private files, transfer mechanics, and validation.

## 1. Storage Constraints (design around these first)

- **There is no bulk file export API.** Bubble's File Manager lists files in the editor but offers no programmatic bulk export. Discovery is driven by **scanning the exported database** for file URLs — this skill consumes the asset manifest produced by the `bubble-db-migration` skill's transformation stage.
- **URL shapes to normalize** (several shapes can refer to the same underlying object; canonicalize before dedup):
  - `//s3.amazonaws.com/appforest_uf/f<timestamp>x<random>/<filename>` — classic form, often protocol-relative.
  - `https://s3.amazonaws.com/appforest_uf/...` — same object, absolute.
  - CDN-wrapped processed images, e.g. `https://<cdn-host>/<url-encoded S3 URL>?w=…&h=…&auto=compress` (imgix-style): URL-decode the inner URL, strip the processing params, and fetch the original. Note which display sizes the app used — resize/compress behavior must be re-implemented in the new stack (Supabase image transforms, imgix, Next Image).
  - Newer apps: `https://<appid>.cdn.bubble.io/...` app-CDN form.
- **Private files** (uploaded with "make private" / attached to a thing): direct fetch returns 403; fetch with the admin API token. **Verify a sample of private files early** — access mechanics are the most version-drifting part of this skill.
- **Critical timing constraint: Bubble deletes an app's files when the app is closed or downgraded.** Asset migration must complete before decommissioning the Bubble app. Say this to the user explicitly and gate any decommission checklist on it.
- Not everything URL-shaped is in scope: external hotlinks stored in file fields stay as-is; only `appforest_uf` / Bubble-CDN URLs migrate.

## 2. Pipeline Architecture

```
Discovery → Canonicalization & Dedup → Download → Upload → URL Rewrite → Validation
```

Checkpoint-driven, like the `bubble-db-migration` pipeline. The central artifact is a persisted **URL map table** — `old_canonical_url → new_url, checksum, size, content_type, status` — stored in the target database. It is simultaneously the checkpoint store (resume from `status`) and the rewrite input.

## 3. Stage 1 — Discovery (three sources, in coverage order)

1. **The asset manifest** from the `bubble-db-migration` skill (file/image-typed fields).
2. **Rich-text fields** — Bubble's Rich Text Editor stores BBCode with `[img]…[/img]` embeds. Regex-scan **all** text columns for Bubble URL patterns, not just file-typed fields. Rich text is the silent coverage killer in real apps.
3. **Editor-uploaded static assets** (logos, backgrounds set in the editor) — these never appear in the database; enumerate them manually from the editor/File Manager as a hand-curated list feeding the same pipeline. They mostly matter to the `bubble-ui-rebuild` skill.

Emit a **discovery report** — file count, total bytes, private-file count, dead links, estimated transfer time — for user review before transferring anything.

## 4. Stages 2–4 — Canonicalize, Download, Upload

- Canonical key = decoded, protocol-normalized, query-stripped S3 path. Dedupe on it; the same file routinely appears under multiple URL shapes.
- **Stream download → upload** (no full local copies for large sets). Record checksum and Content-Type per object — sniff the type; Bubble's metadata is unreliable.
- Modest concurrency with backoff. These fetches hit S3/CDN, **not** the Data API, so they consume no workload units — the throttling calculus differs from data extraction; be polite, not WU-constrained.
- Object key strategy: preserve `f<timestamp>x<random>/<filename>` by default — it guarantees uniqueness and keeps the URL map trivially reversible. Prettier restructuring is opt-in.
- Target notes: Supabase Storage → private files go to private buckets with signed URLs, access policies on `storage.objects` designed together with the `bubble-auth-migration` skill; R2/S3 → put a CDN in front of public assets.

## 5. Stage 5 — URL Rewrite

- Rewrite **in the migrated database only** — never write back to Bubble.
- File/image columns rewrite via the URL map; rich-text bodies rewrite via pattern replacement with canonical-key lookup, so every URL-shape variant of the same file rewrites correctly.
- Keep the rewrite **replayable**: preserve pre-rewrite values (`_original_url` columns, or re-run from the staged NDJSON per the `bubble-db-migration` skill's staging principle).
- During gradual migration with incremental sync, new Bubble records keep arriving with `appforest_uf` URLs until cutover — the rewrite must be an **idempotent, repeatable post-sync step**, not a one-shot.

## 6. Stage 6 — Validation

- Count funnel: discovered → downloaded → uploaded → rewritten, with a per-status failure breakdown (404 dead link, 403 private-fetch failure, oversized).
- Spot checks: sample K objects, byte-compare checksums, HTTP-fetch the new URLs.
- The definitive done-check: **grep the migrated database for residual `appforest_uf` / Bubble-CDN URLs** — zero hits (outside `_original_url` columns) means done.

## 7. Risks & Edge Cases Checklist

1. **Dead links** — things referencing deleted files are normal; report them, don't fail the run.
2. **Private-file access drift** — Bubble's private-file mechanics change; verify sample access before the bulk run.
3. **CDN/imgix wrapping** — always decode to the real object before dedup, or you migrate resized derivatives and miss originals.
4. **Rich text** — file-typed fields alone miss a large fraction of real apps' assets; always scan all text columns.
5. **Uploads during gradual migration** — the rewrite must be re-runnable per sync cycle without corrupting already-rewritten rows.
6. **Very large files / video** — check target per-object caps (plan-dependent on Supabase Storage); always stream, never buffer.
7. **App closure deletes files** — sequence asset migration strictly before any Bubble decommission step.
8. **Filename pathologies** — unicode, spaces, duplicates; derive object keys from the canonical path, not the display filename.

## 8. How to Apply This Skill

- **One-time full transfer**: all stages once; done-check via the residual-URL grep.
- **Gradual migration**: same pipeline with the rewrite as a repeatable post-sync step until cutover.
- Always produce the discovery report for user review **before transferring**.
- Consumes the asset manifest from the `bubble-db-migration` skill; static assets feed the `bubble-ui-rebuild` skill; private-file access policies are designed with the `bubble-auth-migration` skill.
- **Reference implementation**: a zero-dependency Node CLI ships with this skill's repository: https://github.com/inovastudio/bubble-migration-kit/tree/main/tools/bubble-assets (if this skill was installed as the `bubble-migration-kit` plugin, it is already on disk under the plugin's `tools/` directory). Its discovery and URL-canonicalization stages are implemented today; transfer/rewrite/verify are scaffolded with the intended plan printed per stage.
