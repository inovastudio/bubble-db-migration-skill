#!/usr/bin/env node
// bubble-export — zero-dependency CLI for exporting a Bubble.io app's database
// via the Bubble Data API. Reference implementation for the bubble-db-migration
// skill in this repository; command functions cite the skill sections they
// implement. Requires Node.js 18+ (built-in fetch). No npm install needed.
//
// Usage: node bubble-export.mjs <discover|export|sync|sweep> [flags]
// Config: env BUBBLE_APP_URL, BUBBLE_API_TOKEN (or --app / --token).

import { parseArgs } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

// ── Bubble Data API constants (skill §1) ────────────────────────────────────
// The Data API caps `limit` at 100 records per request; asking for more
// silently returns 100.
export const MAX_PAGE_SIZE = 100;
// Bubble unique IDs look like 1699999999999x123456789012345678 — a millisecond
// timestamp, an 'x', and a long random suffix. Used to detect reference fields.
export const BUBBLE_ID_RE = /^\d{13,}x\d{13,}$/;

const HELP = `bubble-export — export a Bubble.io database via the Data API

Commands:
  discover   GET /api/1.1/meta + sample pages -> schema.json plan
  export     Full cursor-walk of types -> <type>.ndjson (resumable)
  sync       Modified Date delta since last checkpoint -> deltas/<ts>/
  sweep      ID-only walk, diffed against exported IDs -> deletions/

Config (env or flags):
  BUBBLE_APP_URL    e.g. https://myapp.bubbleapps.io or your custom domain
  BUBBLE_API_TOKEN  admin API token (Settings -> API in the Bubble editor)

Common flags:
  --app <url> --token <t>   override env
  --out <dir>               output dir (default ./bubble-export-out)
  --types a,b,c             restrict to these types (default: all from /meta)
  --env test                use the Development database (/version-test)
  --verbose                 log every request
Per command:
  discover: --sample-pages <n=3>
  export:   --limit <n> --since <ISO> --concurrency <n=3> --page-size <n=100>
            --throttle-ms <n=0> --no-resume
  sync:     --overlap-minutes <n=5> --concurrency <n=3> --throttle-ms <n=0>
  sweep:    --concurrency <n=3> --throttle-ms <n=0>
`;

// ── Pure helpers (exported for node --test) ─────────────────────────────────

// Backoff schedule for 429/5xx/network errors: honor Retry-After when the
// server sends one, else jittered exponential backoff (1s base, x2, 60s cap).
export function backoffDelay(attempt, retryAfterSeconds = null, random = Math.random) {
  if (retryAfterSeconds != null && Number.isFinite(retryAfterSeconds)) {
    return Math.min(retryAfterSeconds * 1000, 120_000);
  }
  const base = Math.min(1000 * 2 ** attempt, 60_000);
  return Math.round(base / 2 + random() * base / 2); // jitter in [base/2, base]
}

// The `constraints` query parameter is a URL-encoded JSON array, e.g.
// [{"key":"Modified Date","constraint_type":"greater than","value":"<ISO>"}]
// (skill §7 uses exactly this shape for incremental sync deltas).
export function buildConstraints(list) {
  if (!list || list.length === 0) return null;
  return JSON.stringify(list);
}

// Infer a field's type from sampled values (skill §3: /meta typing is coarse;
// refine by sampling actual data).
export function inferFieldType(samples) {
  const present = samples.filter((v) => v !== null && v !== undefined);
  if (present.length === 0) return 'unknown';
  if (present.every((v) => Array.isArray(v))) {
    const inner = inferFieldType(present.flat());
    return inner === 'reference' ? 'list_of_things' : `list_of_${inner}`;
  }
  if (present.every((v) => typeof v === 'boolean')) return 'boolean';
  if (present.every((v) => typeof v === 'number')) {
    return present.every((v) => Number.isInteger(v)) ? 'integer' : 'number';
  }
  if (present.every((v) => typeof v === 'string')) {
    if (present.every((v) => BUBBLE_ID_RE.test(v))) return 'reference';
    if (present.every((v) => !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v))) return 'date';
    // Option-set heuristic: low-cardinality repeated short strings.
    const distinct = new Set(present);
    if (present.length >= 10 && distinct.size <= Math.max(2, present.length / 5) &&
        [...distinct].every((v) => v.length <= 64)) return 'option_set';
    return 'text';
  }
  if (present.every((v) => typeof v === 'object')) return 'object';
  return 'mixed';
}

// Bubble type -> Postgres column type, per the skill §3 mapping table.
export function suggestColumnType(inferred) {
  return {
    boolean: 'BOOLEAN',
    integer: 'BIGINT',
    number: 'NUMERIC',
    date: 'TIMESTAMPTZ',
    reference: 'TEXT', // + FK, validated post-load (skill §6)
    option_set: 'TEXT', // + generated lookup table
    list_of_things: 'JUNCTION_TABLE', // ordered junction table, not a column
    text: 'TEXT',
    object: 'JSONB',
    unknown: 'TEXT',
    mixed: 'JSONB',
  }[inferred] ?? (inferred.startsWith('list_of_') ? 'ARRAY' : 'TEXT');
}

const SQL_RESERVED = new Set(['user', 'order', 'group', 'table', 'select', 'where', 'from', 'to', 'default', 'primary', 'references', 'check', 'index', 'column', 'constraint', 'grant', 'position']);

// Deterministic, collision-safe snake_case renamer (skill §3: expect
// pathological display names — duplicates, emoji, reserved words).
export function toSnakeCase(name) {
  const s = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[-\s]+/g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/^_+|_+$/g, '') || 'field';
  const prefixed = /^\d/.test(s) ? `f_${s}` : s;
  return SQL_RESERVED.has(prefixed) ? `${prefixed}_` : prefixed;
}

export function buildNameMap(fieldNames) {
  const map = {};
  const used = new Set();
  for (const name of fieldNames) {
    let candidate = toSnakeCase(name);
    let i = 2;
    while (used.has(candidate)) candidate = `${toSnakeCase(name)}_${i++}`;
    used.add(candidate);
    map[name] = candidate;
  }
  return map;
}

// Assemble schema.json from /meta plus per-type sampled records (skill §3:
// merge meta inventory, data sampling, then user overrides via this editable
// plan — always review before running a real migration).
export function buildSchemaPlan(meta, samplesByType) {
  const warnings = [];
  const types = {};
  for (const [typeName, records] of Object.entries(samplesByType)) {
    const fieldNames = new Set();
    for (const r of records) Object.keys(r).forEach((k) => fieldNames.add(k));
    const nameMap = buildNameMap([...fieldNames]);
    const fields = {};
    for (const f of fieldNames) {
      const inferred = inferFieldType(records.map((r) => r[f]));
      fields[f] = { column: nameMap[f], inferred, sql: suggestColumnType(inferred) };
      if (inferred === 'reference' || inferred === 'list_of_things') {
        fields[f].note = 'references another type; validate against exported IDs post-load';
      }
    }
    if (records.length === 0) warnings.push(`type ${typeName}: no sample records; types are meta-only guesses`);
    types[typeName] = { sampled: records.length, fields };
  }
  const exposed = Object.keys(samplesByType);
  const metaTypes = meta?.get ?? [];
  for (const t of metaTypes) if (!exposed.includes(t)) warnings.push(`type ${t} listed in /meta but not sampled`);
  return { generatedAt: new Date().toISOString(), types, warnings };
}

// Simple concurrency pool: run fn over items, at most n in flight.
export function pool(items, n, fn) {
  const queue = [...items.entries()];
  const results = new Array(items.length);
  const workers = Array.from({ length: Math.max(1, n) }, async () => {
    while (queue.length > 0) {
      const [i, item] = queue.shift();
      results[i] = await fn(item, i);
    }
  });
  return Promise.all(workers).then(() => results);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── HTTP layer ───────────────────────────────────────────────────────────────

// GET with Bearer auth and retry loop. Retries 429 (honoring Retry-After),
// 5xx, and network errors; fails fast on 401/403/404 with actionable messages.
async function apiGet(cfg, path, params = {}) {
  const url = new URL(cfg.appUrl + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      if (cfg.verbose) console.error(`GET ${url}`);
      res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.token}` } });
    } catch (err) {
      if (attempt >= cfg.maxRetries) throw new Error(`network failure after ${attempt} retries: ${err.message}`);
      await sleep(backoffDelay(attempt));
      cfg.stats.retries++;
      continue;
    }
    cfg.stats.requests++;
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= cfg.maxRetries) throw new Error(`HTTP ${res.status} after ${attempt} retries: ${url.pathname}`);
      if (res.status === 429) cfg.stats.rateLimited++;
      cfg.stats.retries++;
      await sleep(backoffDelay(attempt, Number(res.headers.get('retry-after')) || null));
      continue;
    }
    if (res.status === 404) {
      // Skill §1: only types with "Enable Data API" checked are visible.
      throw new Error(`HTTP 404 for ${url.pathname} — the type may not have "Enable Data API" checked (Settings -> API in the Bubble editor), or the name is wrong.`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`HTTP ${res.status} — check BUBBLE_API_TOKEN (must be an API token from Settings -> API).`);
    }
    throw new Error(`HTTP ${res.status} for ${url.pathname}: ${(await res.text()).slice(0, 300)}`);
  }
}

// One page of a type. The Data API responds with
// {"response": {"results": [...], "cursor": N, "remaining": N, "count": N}}.
async function fetchPage(cfg, type, cursor, { constraints = null, sortField = null } = {}) {
  const params = { cursor, limit: cfg.pageSize };
  if (constraints) params.constraints = constraints;
  if (sortField) { params.sort_field = sortField; params.descending = 'false'; }
  const body = await apiGet(cfg, `/api/1.1/obj/${encodeURIComponent(type)}`, params);
  return body.response ?? body;
}

// Cursor walker (skill §4): advance by results.length — NOT by the requested
// limit — and terminate on remaining === 0 OR an empty page (belt and braces:
// `remaining` can lag on apps with concurrent writes).
async function* walkType(cfg, type, opts = {}) {
  let cursor = opts.startCursor ?? 0;
  while (true) {
    const page = await fetchPage(cfg, type, cursor, opts);
    const results = page.results ?? [];
    if (results.length === 0) return;
    cursor += results.length;
    yield { results, cursor, remaining: page.remaining ?? 0 };
    if ((page.remaining ?? 0) === 0) return;
    if (opts.maxRecords && cursor >= opts.maxRecords) return;
    if (cfg.throttleMs > 0) await sleep(cfg.throttleMs);
  }
}

// ── Persistence ──────────────────────────────────────────────────────────────

function checkpointPath(out, type) { return join(out, 'checkpoints', `${type}.json`); }

function loadCheckpoint(out, type) {
  const p = checkpointPath(out, type);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

// Atomic write (tmp + rename) so a killed job never leaves a torn checkpoint.
function saveCheckpoint(out, type, cp) {
  const p = checkpointPath(out, type);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(`${p}.tmp`, JSON.stringify(cp, null, 2));
  renameSync(`${p}.tmp`, p);
}

function appendNdjson(file, records) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function writeReport(cfg, extra) {
  const report = {
    command: cfg.command,
    app: cfg.appUrl, // token intentionally never written to any output file
    finishedAt: new Date().toISOString(),
    requests: cfg.stats.requests, // request count is the closest client-side proxy for WU spend
    retries: cfg.stats.retries,
    rateLimited: cfg.stats.rateLimited,
    ...extra,
  };
  mkdirSync(cfg.out, { recursive: true });
  writeFileSync(join(cfg.out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`report -> ${join(cfg.out, 'report.json')}`);
}

function maxModified(records, current = null) {
  let max = current;
  for (const r of records) {
    const m = r['Modified Date'];
    if (m && (!max || m > max)) max = m;
  }
  return max;
}

async function listTypes(cfg) {
  if (cfg.types.length > 0) return cfg.types;
  // /api/1.1/meta lists the types exposed to the Data API (skill §1/§3).
  const meta = await apiGet(cfg, '/api/1.1/meta');
  const types = meta.get ?? Object.keys(meta.types ?? {});
  if (types.length === 0) throw new Error('No types exposed to the Data API. Enable Data API on your types in Settings -> API.');
  return types;
}

// ── Commands ─────────────────────────────────────────────────────────────────

// Implements Stage 1 — Schema Discovery (skill §3): /meta inventory refined by
// sampling the first N pages per type; emits an editable, reviewable plan.
async function cmdDiscover(cfg) {
  const meta = await apiGet(cfg, '/api/1.1/meta');
  const types = await listTypes(cfg);
  console.log(`discovered ${types.length} exposed type(s): ${types.join(', ')}`);
  const samplesByType = {};
  await pool(types, cfg.concurrency, async (type) => {
    const samples = [];
    for await (const page of walkType(cfg, type, { maxRecords: cfg.samplePages * cfg.pageSize })) {
      samples.push(...page.results);
    }
    samplesByType[type] = samples;
  });
  const plan = buildSchemaPlan(meta, samplesByType);
  mkdirSync(cfg.out, { recursive: true });
  writeFileSync(join(cfg.out, 'schema.json'), JSON.stringify(plan, null, 2));
  console.log(`schema plan -> ${join(cfg.out, 'schema.json')}`);
  for (const w of plan.warnings) console.warn(`warning: ${w}`);
  console.log('Review and edit schema.json before loading — inference is a starting point, not a decision (skill §3).');
  writeReport(cfg, { types: types.length, sampled: Object.fromEntries(Object.entries(samplesByType).map(([t, s]) => [t, s.length])) });
}

// Implements Stage 2 — Extraction (skill §4): one cursor walker per type,
// parallel across types (not within a cursor), raw NDJSON staging, and a
// checkpoint after every page so a killed job resumes where it stopped.
async function cmdExport(cfg) {
  const types = await listTypes(cfg);
  const constraints = cfg.since
    ? buildConstraints([{ key: 'Modified Date', constraint_type: 'greater than', value: cfg.since }])
    : null;
  const counts = {};
  await pool(types, cfg.concurrency, async (type) => {
    const ndjson = join(cfg.out, `${type}.ndjson`);
    let cp = cfg.resume ? loadCheckpoint(cfg.out, type) : null;
    if (cp?.done) { console.log(`${type}: already complete (${cp.records} records) — skipping (use --no-resume to restart)`); counts[type] = cp.records; return; }
    if (!cp) cp = { cursor: 0, records: 0, pages: 0, lastModified: null, done: false, startedAt: new Date().toISOString() };
    for await (const page of walkType(cfg, type, { startCursor: cp.cursor, constraints, maxRecords: cfg.limit || undefined })) {
      appendNdjson(ndjson, page.results);
      cp.cursor = page.cursor;
      cp.records += page.results.length;
      cp.pages++;
      cp.lastModified = maxModified(page.results, cp.lastModified);
      saveCheckpoint(cfg.out, type, cp);
      if (cfg.verbose) console.error(`${type}: ${cp.records} records (${page.remaining} remaining)`);
    }
    cp.done = true;
    saveCheckpoint(cfg.out, type, cp);
    counts[type] = cp.records;
    console.log(`${type}: ${cp.records} records -> ${ndjson}`);
  });
  writeReport(cfg, { counts });
}

// Implements Incremental Sync (skill §7): Modified Date delta with an overlap
// window to absorb clock skew and in-flight writes. Output goes to a separate
// deltas/<ts>/ dir — it is upsert input, kept apart from the base export for
// replayability. Deletions are NOT visible to deltas; run `sweep` for those.
async function cmdSync(cfg) {
  const types = await listTypes(cfg);
  const runDir = join(cfg.out, 'deltas', new Date().toISOString().replace(/[:.]/g, '-'));
  const counts = {};
  await pool(types, cfg.concurrency, async (type) => {
    const cp = loadCheckpoint(cfg.out, type);
    if (!cp?.lastModified) { console.warn(`${type}: no checkpoint with lastModified — run a full export first`); counts[type] = 0; return; }
    const since = new Date(new Date(cp.lastModified).getTime() - cfg.overlapMinutes * 60_000).toISOString();
    const constraints = buildConstraints([{ key: 'Modified Date', constraint_type: 'greater than', value: since }]);
    let n = 0;
    let newest = cp.lastModified;
    for await (const page of walkType(cfg, type, { constraints, sortField: 'Modified Date' })) {
      appendNdjson(join(runDir, `${type}.ndjson`), page.results);
      n += page.results.length;
      newest = maxModified(page.results, newest);
    }
    cp.lastModified = newest;
    saveCheckpoint(cfg.out, type, cp);
    counts[type] = n;
    console.log(`${type}: ${n} changed record(s) since ${since}`);
  });
  writeReport(cfg, { deltaDir: runDir, counts });
  console.log('Reminder: deltas never contain deletions — schedule `sweep` for deletion reconciliation (skill §7).');
}

// Implements deletion reconciliation (skill §7): the Data API has no deletion
// tombstones, so deleted records are invisible to delta queries. Walk each
// type retaining only _id (no field projection exists — full pages are
// fetched but only IDs kept), then diff against the previously exported IDs.
async function cmdSweep(cfg) {
  const types = await listTypes(cfg);
  const results = {};
  await pool(types, cfg.concurrency, async (type) => {
    const ndjson = join(cfg.out, `${type}.ndjson`);
    if (!existsSync(ndjson)) { console.warn(`${type}: no ${type}.ndjson to diff against — run export first`); return; }
    const live = new Set();
    for await (const page of walkType(cfg, type)) {
      for (const r of page.results) live.add(r._id);
    }
    const idsFile = join(cfg.out, 'ids', `${type}.ids`);
    mkdirSync(dirname(idsFile), { recursive: true });
    writeFileSync(idsFile, [...live].join('\n') + '\n');
    const exported = new Set();
    for (const line of readFileSync(ndjson, 'utf8').split('\n')) {
      if (line.trim()) exported.add(JSON.parse(line)._id);
    }
    // Also count deltas so records created after the base export aren't
    // misreported as "new to Bubble".
    const deltasDir = join(cfg.out, 'deltas');
    if (existsSync(deltasDir)) {
      for (const run of readdirSync(deltasDir)) {
        const f = join(deltasDir, run, `${type}.ndjson`);
        if (existsSync(f)) for (const line of readFileSync(f, 'utf8').split('\n')) if (line.trim()) exported.add(JSON.parse(line)._id);
      }
    }
    const deleted = [...exported].filter((id) => !live.has(id));
    const out = { type, liveInBubble: live.size, exported: exported.size, missingFromBubble: deleted };
    const delFile = join(cfg.out, 'deletions', `${type}.json`);
    mkdirSync(dirname(delFile), { recursive: true });
    writeFileSync(delFile, JSON.stringify(out, null, 2));
    results[type] = { live: live.size, exported: exported.size, deleted: deleted.length };
    console.log(`${type}: ${deleted.length} deletion(s) detected (${live.size} live vs ${exported.size} exported)`);
  });
  writeReport(cfg, { sweep: results });
  console.log('Apply deletions per your policy: soft-delete (_deleted_at) or hard-delete (skill §7).');
}

// ── CLI entrypoint ───────────────────────────────────────────────────────────

export function loadConfig(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      app: { type: 'string' }, token: { type: 'string' }, out: { type: 'string' },
      types: { type: 'string' }, env: { type: 'string' }, verbose: { type: 'boolean' },
      limit: { type: 'string' }, since: { type: 'string' }, concurrency: { type: 'string' },
      'page-size': { type: 'string' }, 'throttle-ms': { type: 'string' },
      'no-resume': { type: 'boolean' }, 'sample-pages': { type: 'string' },
      'overlap-minutes': { type: 'string' }, help: { type: 'boolean' },
    },
  });
  const command = positionals[0];
  if (values.help || !command) { console.log(HELP); process.exit(command ? 0 : 1); }
  let appUrl = values.app ?? process.env.BUBBLE_APP_URL;
  const token = values.token ?? process.env.BUBBLE_API_TOKEN;
  if (!appUrl || !token) { console.error('error: BUBBLE_APP_URL and BUBBLE_API_TOKEN are required (env or --app/--token)'); process.exit(1); }
  appUrl = appUrl.replace(/\/+$/, '');
  if (values.env === 'test') appUrl += '/version-test'; // Development database
  const num = (v, d) => (v != null ? Number(v) : d);
  return {
    command, appUrl, token,
    out: values.out ?? './bubble-export-out',
    types: values.types ? values.types.split(',').map((s) => s.trim()).filter(Boolean) : [],
    verbose: Boolean(values.verbose),
    limit: num(values.limit, 0),
    since: values.since ?? null,
    concurrency: num(values.concurrency, 3), // modest default respects WU budgets (skill §4)
    pageSize: Math.min(num(values['page-size'], MAX_PAGE_SIZE), MAX_PAGE_SIZE),
    throttleMs: num(values['throttle-ms'], 0),
    resume: !values['no-resume'],
    samplePages: num(values['sample-pages'], 3),
    overlapMinutes: num(values['overlap-minutes'], 5),
    maxRetries: 8,
    stats: { requests: 0, retries: 0, rateLimited: 0 },
  };
}

async function main() {
  const cfg = loadConfig(process.argv.slice(2));
  // Skill §1/§9.2: a non-admin token yields a partial export that LOOKS
  // complete. The API gives no way to detect it client-side, so warn loudly.
  console.warn('NOTE: use an ADMIN API token — a non-admin token silently produces a partial export that looks complete (privacy rules filter it).');
  const commands = { discover: cmdDiscover, export: cmdExport, sync: cmdSync, sweep: cmdSweep };
  const fn = commands[cfg.command];
  if (!fn) { console.error(`unknown command: ${cfg.command}\n${HELP}`); process.exit(1); }
  try {
    await fn(cfg);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
