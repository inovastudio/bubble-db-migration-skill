#!/usr/bin/env node
// bubble-assets — asset migration companion to the bubble-files-migration
// skill. Discovery and URL canonicalization are implemented; the network/DB
// stages (transfer, rewrite, verify) are scaffolded: they print their intended
// execution plan and exit 2. Requires Node.js 18+, zero npm dependencies.
//
// Usage: node bubble-assets.mjs <discover|transfer|rewrite|verify> [flags]

import { parseArgs } from 'node:util';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const HELP = `bubble-assets — migrate files off Bubble's storage

Commands:
  discover   Scan bubble-export NDJSON output for Bubble-hosted asset URLs
             -> asset-manifest.json (implemented)
  transfer   Stream download from Bubble S3/CDN -> upload to target storage (scaffold)
  rewrite    Rewrite asset URLs in the migrated database via the URL map     (scaffold)
  verify     Checksum spot-checks + residual-URL grep                        (scaffold)

Flags:
  discover: --in <dir>   bubble-export output dir (default ./bubble-export-out)
            --out <file> manifest path (default <in>/asset-manifest.json)
`;

// ── URL canonicalization (implemented; skill §1's four URL shapes) ──────────
// Bubble asset URLs appear in several shapes that can all point at the same
// underlying S3 object. Canonicalize before dedup:
//   1. //s3.amazonaws.com/appforest_uf/f<ts>x<rand>/<file>   (protocol-relative)
//   2. https://s3.amazonaws.com/appforest_uf/...             (absolute)
//   3. https://<cdn-host>/<url-encoded S3 URL>?w=..&h=..     (imgix/CDN-wrapped)
//   4. https://<appid>.cdn.bubble.io/...                     (newer app CDN)
export function canonicalizeUrl(raw) {
  if (typeof raw !== 'string' || raw.length < 10) return { canonical: null, isBubbleAsset: false };
  let url = raw.trim();
  if (url.startsWith('//')) url = 'https:' + url; // shape 1 -> absolute
  let wasCdnWrapped = false;
  let processingParams = null;
  let parsed;
  try { parsed = new URL(url); } catch { return { canonical: null, isBubbleAsset: false }; }

  // Shape 3: CDN/imgix wrapper — the real S3 URL is URL-encoded in the path.
  // Decode the inner URL and strip the processing params (w/h/auto/...), but
  // report them: the new stack must re-implement that resizing.
  const encodedInner = parsed.pathname.slice(1);
  const decodedInner = decodeURIComponent(encodedInner);
  if (/^(https?:)?\/\/s3\.amazonaws\.com\/appforest_uf\//.test(decodedInner)) {
    wasCdnWrapped = true;
    processingParams = parsed.search ? parsed.search.slice(1) : null;
    url = decodedInner.startsWith('//') ? 'https:' + decodedInner : decodedInner;
    try { parsed = new URL(url); } catch { return { canonical: null, isBubbleAsset: false }; }
  }

  const isClassic = parsed.hostname === 's3.amazonaws.com' && parsed.pathname.startsWith('/appforest_uf/');
  const isAppCdn = parsed.hostname.endsWith('.cdn.bubble.io'); // shape 4
  if (!isClassic && !isAppCdn) return { canonical: null, isBubbleAsset: false }; // external hotlink: out of scope

  // Canonical key: protocol-normalized, query-stripped host+path.
  const canonical = `https://${parsed.hostname}${parsed.pathname}`;
  return { canonical, isBubbleAsset: true, wasCdnWrapped, processingParams };
}

// Find every Bubble asset URL inside a string — covers plain URL fields AND
// rich-text bodies. Bubble's Rich Text Editor stores BBCode with [img]...[/img]
// embeds, so file-typed fields alone miss a large fraction of real apps'
// assets (skill §3.2: "rich text is the silent coverage killer").
const URL_IN_TEXT_RE = /(?:https?:)?\/\/(?:s3\.amazonaws\.com\/appforest_uf\/|[\w.-]+\.cdn\.bubble\.io\/|[\w.-]+\/(?:https?%3A|%2F%2F))[^\s"'\]\[)>,]+/g;

export function extractAssetUrls(value) {
  const found = [];
  const walk = (v) => {
    if (typeof v === 'string') {
      for (const m of v.match(URL_IN_TEXT_RE) ?? []) {
        const c = canonicalizeUrl(m);
        if (c.isBubbleAsset) found.push({ raw: m, ...c });
      }
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return found;
}

// ── discover (implemented; skill §3 discovery stage) ────────────────────────
function cmdDiscover(flags) {
  const inDir = flags.in ?? './bubble-export-out';
  if (!existsSync(inDir)) { console.error(`error: input dir ${inDir} not found — run bubble-export first`); process.exit(1); }
  const manifest = new Map(); // canonical -> {canonical, sources: [{type, _id, field?}], wasCdnWrapped, processingParams}
  let records = 0;
  const scanFile = (file, type) => {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      records++;
      const rec = JSON.parse(line);
      for (const hit of extractAssetUrls(rec)) {
        const entry = manifest.get(hit.canonical) ?? { canonical: hit.canonical, cdnWrapped: false, processingParams: new Set(), sources: [] };
        entry.cdnWrapped ||= hit.wasCdnWrapped;
        if (hit.processingParams) entry.processingParams.add(hit.processingParams);
        if (entry.sources.length < 20) entry.sources.push({ type, _id: rec._id });
        manifest.set(hit.canonical, entry);
      }
    }
  };
  const scanDir = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) scanDir(p); // deltas/<ts>/ included
      else if (name.endsWith('.ndjson')) scanFile(p, name.replace(/\.ndjson$/, ''));
    }
  };
  scanDir(inDir);
  const assets = [...manifest.values()].map((e) => ({ ...e, processingParams: [...e.processingParams] }));
  const outFile = flags.out ?? join(inDir, 'asset-manifest.json');
  mkdirSync(join(outFile, '..'), { recursive: true });
  writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), scannedRecords: records, assets }, null, 2));
  const cdnWrapped = assets.filter((a) => a.cdnWrapped).length;
  console.log(`scanned ${records} record(s); ${assets.length} unique Bubble asset(s) (${cdnWrapped} were CDN/imgix-wrapped)`);
  console.log(`manifest -> ${outFile}`);
  console.log('Note: editor-uploaded static assets (logos, backgrounds) never appear in the database — enumerate those manually from the Bubble editor.');
}

// ── scaffolded stages ────────────────────────────────────────────────────────
function scaffold(name, planLines) {
  console.log(`${name}: NOT IMPLEMENTED (scaffold). A full implementation will:`);
  for (const l of planLines) console.log(`  - ${l}`);
  console.log('See the bubble-files-migration skill for the complete methodology.');
  process.exit(2);
}

// TODO(scaffold): implement streaming transfer per skill §4.
function cmdTransfer() {
  scaffold('transfer', [
    'read asset-manifest.json and build a URL-map table (old_canonical_url -> new_url, checksum, size, content_type, status) as both checkpoint store and rewrite input',
    'fetch private files with the admin API token (verify a sample FIRST — direct fetches return 403)',
    'stream download -> upload to the target (Supabase Storage / R2 / S3); sniff Content-Type, record checksums; modest concurrency with backoff',
    'preserve the f<ts>x<rand>/<filename> path as the object key by default',
    'IMPORTANT: Bubble deletes an app\'s files when the app is closed or downgraded — run transfer to completion BEFORE any decommission step',
  ]);
}

// TODO(scaffold): implement DB rewrite per skill §5.
function cmdRewrite() {
  scaffold('rewrite', [
    'rewrite file/image columns in the migrated database via the URL map (never write back to Bubble)',
    'rewrite rich-text bodies by pattern replacement with canonical-key lookup so every URL-shape variant rewrites correctly',
    'keep pre-rewrite values (_original_url columns) so the rewrite is replayable',
    'stay idempotent and re-runnable per incremental-sync cycle until cutover',
  ]);
}

// TODO(scaffold): implement validation per skill §6.
function cmdVerify() {
  scaffold('verify', [
    'report the count funnel: discovered -> downloaded -> uploaded -> rewritten, with per-status failures (404 dead link, 403 private, oversized)',
    'sample K objects: byte-compare checksums and HTTP-fetch the new URLs',
    'grep the migrated database for residual appforest_uf / cdn.bubble.io URLs — zero hits means done',
  ]);
}

function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { in: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean' } },
  });
  const command = positionals[0];
  if (values.help || !command) { console.log(HELP); process.exit(command ? 0 : 1); }
  const commands = { discover: cmdDiscover, transfer: cmdTransfer, rewrite: cmdRewrite, verify: cmdVerify };
  const fn = commands[command];
  if (!fn) { console.error(`unknown command: ${command}\n${HELP}`); process.exit(1); }
  fn(values);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
