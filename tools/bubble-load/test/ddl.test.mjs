// Tests for DDL generation from a fixture schema plan. Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDdl, toTableName } from '../bubble-load.mjs';

const PLAN = {
  types: {
    Product: {
      fields: {
        _id: { column: '_id', inferred: 'reference', sql: 'TEXT' },
        Name: { column: 'name', inferred: 'text', sql: 'TEXT' },
        Price: { column: 'price', inferred: 'number', sql: 'NUMERIC' },
        Category: { column: 'category', inferred: 'option_set', sql: 'TEXT' },
        Owner: { column: 'owner', inferred: 'reference', sql: 'TEXT' },
        'Related Items': { column: 'related_items', inferred: 'list_of_things', sql: 'JUNCTION_TABLE' },
        Tags: { column: 'tags', inferred: 'list_of_text', sql: 'ARRAY' },
        'Modified Date': { column: 'modified_date', inferred: 'date', sql: 'TIMESTAMPTZ' },
      },
    },
  },
};

test('toTableName normalizes type names', () => {
  assert.equal(toTableName('Product'), 'product');
  assert.equal(toTableName('Line Item'), 'line_item');
  assert.equal(toTableName('123abc'), 't_123abc');
});

test('generateDdl encodes the skill mapping table', () => {
  const sql = generateDdl(PLAN);
  assert.match(sql, /CREATE TABLE "product" \(\n  "_id" TEXT PRIMARY KEY/);
  assert.match(sql, /"price" NUMERIC/);
  assert.match(sql, /"tags" TEXT\[\]/);
  assert.match(sql, /"_extra" JSONB/); // schema-drift landing zone
  // Ordered junction table for list-of-Things, with position.
  assert.match(sql, /CREATE TABLE "product_related_items"/);
  assert.match(sql, /"position" INTEGER NOT NULL/);
  // Option-set lookup table.
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "option_set_category"/);
  // Modified Date index (drives incremental sync).
  assert.match(sql, /CREATE INDEX ON "product" \("modified_date"\)/);
  // FKs live in the apply-after-load section, after the base tables.
  assert.ok(sql.indexOf('APPLY AFTER LOAD') > sql.indexOf('CREATE TABLE "product"'));
  assert.match(sql, /TODO: set target table for product\.owner/);
});

test('junction fields never become columns', () => {
  const sql = generateDdl(PLAN);
  assert.ok(!/CREATE TABLE "product" \([^;]*related_items[^;]*\);/s.test(sql.split('Junction')[0]));
});
