// Integration tests: run the real CLI as a child process against the mock
// Bubble Data API server. Covers discover, export (with an injected 429),
// resume, sync deltas, and sweep deletion detection. Run: node --test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { startServer, makeState } from './mock-bubble-server.mjs';

const exec = promisify(execFile);
const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bubble-export.mjs');

let srv;
let out;

before(async () => {
  srv = await startServer(makeState());
  out = mkdtempSync(join(tmpdir(), 'bubble-export-test-'));
});
after(() => {
  srv.server.close();
  rmSync(out, { recursive: true, force: true });
});

function run(args) {
  return exec(process.execPath, [CLI, ...args, '--app', `http://127.0.0.1:${srv.port}`, '--token', srv.token, '--out', out]);
}

const ndjsonLines = (file) => readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());

test('discover writes a schema plan with inferred types', async () => {
  await run(['discover', '--sample-pages', '1']);
  const plan = JSON.parse(readFileSync(join(out, 'schema.json'), 'utf8'));
  assert.ok(plan.types.product && plan.types.order);
  assert.equal(plan.types.order.fields.Product.inferred, 'reference');
  assert.equal(plan.types.product.fields.Active.inferred, 'boolean');
  assert.equal(plan.types.product.fields.Tags.inferred, 'list_of_text');
});

test('export walks all pages, survives the injected 429, resumes when re-run', async () => {
  await run(['export']);
  assert.equal(ndjsonLines(join(out, 'product.ndjson')).length, 250);
  assert.equal(ndjsonLines(join(out, 'order.ndjson')).length, 30);
  const cp = JSON.parse(readFileSync(join(out, 'checkpoints', 'product.json'), 'utf8'));
  assert.equal(cp.records, 250);
  assert.equal(cp.done, true);
  assert.ok(cp.lastModified);
  const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  assert.ok(!JSON.stringify(report).includes(srv.token), 'token must never reach output files');

  // Re-run: completed checkpoints short-circuit — no duplicate lines appended.
  const { stdout } = await run(['export']);
  assert.match(stdout, /already complete/);
  assert.equal(ndjsonLines(join(out, 'product.ndjson')).length, 250);
});

test('sync picks up only records modified after the checkpoint', async () => {
  // Mutate one product "in Bubble" after the export.
  const rec = srv.state.types.product[7];
  rec.Name = 'Renamed after export';
  rec['Modified Date'] = new Date(Date.now() + 60_000).toISOString();

  const { stdout } = await run(['sync', '--overlap-minutes', '0']);
  assert.match(stdout, /product: 1 changed record\(s\)/);
  const deltasRoot = join(out, 'deltas');
  assert.ok(existsSync(deltasRoot));
  // Exactly one delta run dir with exactly the mutated record.
  const runs = (await import('node:fs')).readdirSync(deltasRoot);
  assert.equal(runs.length, 1);
  const delta = ndjsonLines(join(deltasRoot, runs[0], 'product.ndjson')).map((l) => JSON.parse(l));
  assert.equal(delta.length, 1);
  assert.equal(delta[0].Name, 'Renamed after export');
});

test('sweep detects a record deleted from Bubble', async () => {
  const deletedId = srv.state.types.product[3]._id;
  srv.state.types.product.splice(3, 1); // "delete" it in Bubble

  await run(['sweep']);
  const deletions = JSON.parse(readFileSync(join(out, 'deletions', 'product.json'), 'utf8'));
  assert.deepEqual(deletions.missingFromBubble, [deletedId]);
  assert.equal(deletions.liveInBubble, 249);
  // The synced (modified) record must NOT be reported as deleted.
  assert.ok(!deletions.missingFromBubble.includes(srv.state.types.product[6]._id));
});

test('unknown type gives the actionable Data API error', async () => {
  await assert.rejects(
    () => run(['export', '--types', 'nope']),
    (err) => /Enable Data API/.test(err.stderr),
  );
});
