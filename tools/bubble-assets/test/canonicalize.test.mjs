// Table-driven tests for URL canonicalization and asset extraction.
// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeUrl, extractAssetUrls } from '../bubble-assets.mjs';

const S3 = 'https://s3.amazonaws.com/appforest_uf/f1700000000000x123456789012345678/photo.png';

test('canonicalizeUrl handles the four Bubble URL shapes', () => {
  const cases = [
    // [input, expectedCanonical, isBubbleAsset, wasCdnWrapped]
    ['//s3.amazonaws.com/appforest_uf/f1700000000000x123456789012345678/photo.png', S3, true, false],
    [S3, S3, true, false],
    [`https://d1muf25xaso8hp.cloudfront.net/${encodeURIComponent(S3)}?w=128&h=128&auto=compress`, S3, true, true],
    ['https://myapp.cdn.bubble.io/f1700000000000x123456789012345678/photo.png',
      'https://myapp.cdn.bubble.io/f1700000000000x123456789012345678/photo.png', true, false],
  ];
  for (const [input, canonical, isAsset, wrapped] of cases) {
    const r = canonicalizeUrl(input);
    assert.equal(r.isBubbleAsset, isAsset, input);
    assert.equal(r.canonical, canonical, input);
    assert.equal(Boolean(r.wasCdnWrapped), wrapped, input);
  }
});

test('canonicalizeUrl strips query params into processingParams', () => {
  const wrapped = canonicalizeUrl(`https://cdn.example.net/${encodeURIComponent(S3)}?w=64&auto=compress`);
  assert.equal(wrapped.canonical, S3);
  assert.equal(wrapped.processingParams, 'w=64&auto=compress');
});

test('external hotlinks and junk are not Bubble assets', () => {
  assert.equal(canonicalizeUrl('https://example.com/image.png').isBubbleAsset, false);
  assert.equal(canonicalizeUrl('https://s3.amazonaws.com/other_bucket/x.png').isBubbleAsset, false);
  assert.equal(canonicalizeUrl('not a url').isBubbleAsset, false);
  assert.equal(canonicalizeUrl(null).isBubbleAsset, false);
});

test('protocol-relative and CDN-wrapped variants dedupe to the same canonical key', () => {
  const a = canonicalizeUrl('//s3.amazonaws.com/appforest_uf/f1700000000000x123456789012345678/photo.png');
  const b = canonicalizeUrl(`https://d1muf25xaso8hp.cloudfront.net/${encodeURIComponent(S3)}?w=256`);
  assert.equal(a.canonical, b.canonical);
});

test('extractAssetUrls finds embeds in rich-text BBCode and nested values', () => {
  const record = {
    _id: '1700000000000x111111111111111111',
    Photo: `//s3.amazonaws.com/appforest_uf/f1700000000000x123456789012345678/photo.png`,
    Bio: `Hello [img]${S3}[/img] world, also https://example.com/not-bubble.png`,
    Nested: { Gallery: [S3] },
  };
  const hits = extractAssetUrls(record);
  assert.equal(hits.length, 3); // Photo + Bio embed + Nested gallery (all same canonical)
  assert.ok(hits.every((h) => h.canonical === S3));
});
