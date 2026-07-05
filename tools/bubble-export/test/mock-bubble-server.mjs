// Minimal mock of the Bubble Data API for integration-testing bubble-export.
// Serves /api/1.1/meta and /api/1.1/obj/<type> with real cursor/remaining/count
// pagination semantics, constraint filtering on Modified Date, and one injected
// 429 (with Retry-After: 1) on the first page of the "product" type.
// Start standalone: node mock-bubble-server.mjs [port]
// Or import { startServer } for tests.

import { createServer } from 'node:http';

const TOKEN = 'test-token';

function makeRecord(type, i) {
  const created = new Date(Date.UTC(2025, 0, 1) + i * 60_000).toISOString();
  const base = {
    _id: `${1700000000000 + i}x${String(100000000000000000n + BigInt(i))}`,
    'Created Date': created,
    'Modified Date': created,
    'Created By': `${1690000000000}x${'1'.repeat(18)}`,
  };
  if (type === 'product') {
    return {
      ...base,
      Name: `Product ${i}`,
      Price: i % 3 === 0 ? i + 0.5 : i,
      Active: i % 2 === 0,
      Category: ['electronics', 'toys', 'books'][i % 3], // option-set-like
      Tags: [`tag-${i}`, `extra-${i}`],
      Photo: `//s3.amazonaws.com/appforest_uf/f${1700000000000 + i}x${'2'.repeat(18)}/photo${i}.png`,
    };
  }
  return {
    ...base,
    Title: `Order ${i}`,
    Product: `${1700000000000 + (i % 250)}x${String(100000000000000000n + BigInt(i % 250))}`, // reference into product
    Notes: `Some notes for order ${i}`,
  };
}

export function makeState() {
  return {
    types: {
      product: Array.from({ length: 250 }, (_, i) => makeRecord('product', i)),
      order: Array.from({ length: 30 }, (_, i) => makeRecord('order', i)),
    },
    injected429: false, // first product page returns one 429 to exercise backoff
    requests: 0,
  };
}

export function startServer(state = makeState(), port = 0) {
  const server = createServer((req, res) => {
    state.requests++;
    const url = new URL(req.url, 'http://localhost');
    const send = (code, body, headers = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'unauthorized' });

    // Optional /version-test prefix (Development database).
    const path = url.pathname.replace(/^\/version-test/, '');

    if (path === '/api/1.1/meta') {
      return send(200, { get: Object.keys(state.types), post: [] });
    }
    const m = path.match(/^\/api\/1\.1\/obj\/([^/]+)$/);
    if (m) {
      const type = decodeURIComponent(m[1]);
      const all = state.types[type];
      if (!all) return send(404, { error: 'unknown type' });
      if (type === 'product' && !state.injected429) {
        state.injected429 = true;
        return send(429, { error: 'rate limited' }, { 'retry-after': '1' });
      }
      let rows = all;
      const constraints = url.searchParams.get('constraints');
      if (constraints) {
        for (const c of JSON.parse(constraints)) {
          if (c.key === 'Modified Date' && c.constraint_type === 'greater than') {
            rows = rows.filter((r) => r['Modified Date'] > c.value);
          }
        }
      }
      if (url.searchParams.get('sort_field') === 'Modified Date') {
        rows = [...rows].sort((a, b) => a['Modified Date'].localeCompare(b['Modified Date']));
      }
      const cursor = Number(url.searchParams.get('cursor') ?? 0);
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 100);
      const results = rows.slice(cursor, cursor + limit);
      return send(200, {
        response: {
          results,
          cursor,
          count: results.length,
          remaining: Math.max(0, rows.length - cursor - results.length),
        },
      });
    }
    send(404, { error: 'not found' });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, token: TOKEN, state }));
  });
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { port } = await startServer(makeState(), Number(process.argv[2] ?? 8787));
  console.log(`mock Bubble Data API on http://127.0.0.1:${port} (token: ${TOKEN})`);
}
