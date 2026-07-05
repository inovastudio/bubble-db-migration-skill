// Unit tests for bubble-export's pure functions. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  backoffDelay, buildConstraints, inferFieldType, suggestColumnType,
  toSnakeCase, buildNameMap, buildSchemaPlan, pool, BUBBLE_ID_RE, MAX_PAGE_SIZE,
} from '../bubble-export.mjs';

test('backoffDelay honors Retry-After and caps it', () => {
  assert.equal(backoffDelay(0, 3), 3000);
  assert.equal(backoffDelay(5, 500), 120_000);
});

test('backoffDelay grows exponentially with jitter and caps at 60s', () => {
  const fixed = () => 0.5; // jitter midpoint -> 0.75 * base
  assert.equal(backoffDelay(0, null, fixed), 750);
  assert.equal(backoffDelay(1, null, fixed), 1500);
  assert.equal(backoffDelay(2, null, fixed), 3000);
  assert.equal(backoffDelay(10, null, fixed), 45_000); // base capped at 60s
});

test('buildConstraints emits the Data API JSON shape', () => {
  assert.equal(buildConstraints([]), null);
  assert.equal(buildConstraints(null), null);
  const c = buildConstraints([{ key: 'Modified Date', constraint_type: 'greater than', value: '2026-01-01T00:00:00Z' }]);
  assert.deepEqual(JSON.parse(c), [{ key: 'Modified Date', constraint_type: 'greater than', value: '2026-01-01T00:00:00Z' }]);
});

test('BUBBLE_ID_RE matches Bubble unique IDs only', () => {
  assert.ok(BUBBLE_ID_RE.test('1699999999999x123456789012345678'));
  assert.ok(!BUBBLE_ID_RE.test('not-an-id'));
  assert.ok(!BUBBLE_ID_RE.test('123x456'));
});

test('inferFieldType: references, dates, ints vs floats, option sets, lists', () => {
  const id = '1700000000000x123456789012345678';
  assert.equal(inferFieldType([id, id]), 'reference');
  assert.equal(inferFieldType(['2026-01-01T00:00:00.000Z']), 'date');
  assert.equal(inferFieldType([1, 2, 3]), 'integer');
  assert.equal(inferFieldType([1, 2.5]), 'number');
  assert.equal(inferFieldType([true, false]), 'boolean');
  assert.equal(inferFieldType([[id], [id, id]]), 'list_of_things');
  assert.equal(inferFieldType([['a'], ['b']]), 'list_of_text');
  // option set: low-cardinality repeated strings across >=10 samples
  assert.equal(inferFieldType(Array.from({ length: 20 }, (_, i) => ['red', 'blue'][i % 2])), 'option_set');
  assert.equal(inferFieldType(['free text one', 'totally different', 'another']), 'text');
  assert.equal(inferFieldType([null, undefined]), 'unknown');
});

test('suggestColumnType follows the skill mapping table', () => {
  assert.equal(suggestColumnType('reference'), 'TEXT');
  assert.equal(suggestColumnType('list_of_things'), 'JUNCTION_TABLE');
  assert.equal(suggestColumnType('list_of_text'), 'ARRAY');
  assert.equal(suggestColumnType('date'), 'TIMESTAMPTZ');
  assert.equal(suggestColumnType('option_set'), 'TEXT');
});

test('toSnakeCase handles pathological names', () => {
  assert.equal(toSnakeCase('Product Name'), 'product_name');
  assert.equal(toSnakeCase('camelCaseName'), 'camel_case_name');
  assert.equal(toSnakeCase('emoji 🎉 field'), 'emoji_field');
  assert.equal(toSnakeCase('order'), 'order_'); // SQL reserved
  assert.equal(toSnakeCase('123 numbers first'), 'f_123_numbers_first');
  assert.equal(toSnakeCase('***'), 'field');
});

test('buildNameMap is deterministic and collision-safe', () => {
  const map = buildNameMap(['Product Name', 'product name', 'Product-Name']);
  assert.equal(map['Product Name'], 'product_name');
  assert.equal(map['product name'], 'product_name_2');
  assert.equal(map['Product-Name'], 'product_name_3');
});

test('buildSchemaPlan flags reference fields and empty types', () => {
  const id = '1700000000000x123456789012345678';
  const plan = buildSchemaPlan({ get: ['product', 'ghost'] }, {
    product: [{ _id: id, Name: 'A', Owner: id }],
    ghost: [],
  });
  assert.equal(plan.types.product.fields.Owner.inferred, 'reference');
  assert.ok(plan.types.product.fields.Owner.note.includes('references'));
  assert.ok(plan.warnings.some((w) => w.includes('ghost')));
});

test('pool respects concurrency and preserves order', async () => {
  let inFlight = 0, maxInFlight = 0;
  const results = await pool([10, 20, 30, 40, 50], 2, async (x) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return x * 2;
  });
  assert.deepEqual(results, [20, 40, 60, 80, 100]);
  assert.ok(maxInFlight <= 2);
});

test('MAX_PAGE_SIZE is the documented Data API cap', () => {
  assert.equal(MAX_PAGE_SIZE, 100);
});
