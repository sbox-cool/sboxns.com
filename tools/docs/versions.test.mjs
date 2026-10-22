import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(site, 'docs');
const catalog = JSON.parse(readFileSync(path.join(out, 'versions.json'), 'utf8'));
const htmlAt = (base, slug = '') => readFileSync(path.join(site, base, slug, 'index.html'), 'utf8');

for (const pair of catalog.versions) {
  test(`${pair.server.id}/${pair.library.id}: navigation and search cannot cross version boundaries`, () => {
    const index = JSON.parse(readFileSync(path.join(site, pair.basePath, 'search-index.json'), 'utf8'));
    for (const result of index) {
      assert.ok(result.u.startsWith(pair.basePath + '/'), result.u);
      assert.ok(existsSync(path.join(site, result.u.split('#')[0], 'index.html')), result.u);
    }
    const visit = dir => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) visit(full);
        else if (name === 'index.html') {
          const html = readFileSync(full, 'utf8');
          const nav = html.match(/<nav class="doc-nav docs-nav"[\s\S]*?<\/nav>/)?.[0];
          assert.ok(nav, full);
          for (const [, href] of nav.matchAll(/href="([^"]+)"/g)) assert.ok(href.startsWith(pair.basePath + '/'), `${full}: ${href}`);
          assert.ok(html.includes(`${pair.basePath}/search-index.json`), full);
          for (const [, href] of html.matchAll(/<option[^>]*value="([^"]+)"/g)) {
            assert.ok(existsSync(path.join(site, href.split('?')[0], 'index.html')), `${full}: selector target ${href}`);
          }
        }
      }
    };
    visit(path.join(site, pair.basePath));
  });
}

test('historical library reference preserves the pre-identity public API', () => {
  const current = htmlAt('/docs/versions/0.5.4/source-13f51a8', 'library/api');
  const legacy = htmlAt('/docs/versions/0.5.4/source-d369d1b', 'library/api');
  assert.match(current, /LibraryVersion/);
  assert.doesNotMatch(legacy, /LibraryVersion/);
  assert.match(current, /13f51a81f046b1722a6b747712afebccaa9559b3/);
  assert.match(legacy, /d369d1b0a43e30016fa919f260c696dc6aa255a6/);
});

test('source selection never certifies publication or compatibility', () => {
  for (const pair of catalog.versions) {
    if (pair.library.publication.status === 'unverified') {
      assert.equal(pair.library.publication.revision, null);
      assert.match(htmlAt(pair.basePath), /not a confirmed s&amp;box published build|publication (?:is )?unverified|publication has not been verified/i);
    }
  }
  assert.match(htmlAt('/docs/versions'), /not certified compatibility pairings/);
});

test('switching to a version without a guide exposes the gap instead of substituting current content', () => {
  const modules = htmlAt('/docs/versions/0.5.4/source-13f51a8', 'server/modules');
  assert.match(modules, /value="\/docs\/versions\/\?missing=server%2Fmodules&amp;server=0\.1\.0&amp;library=source-13f51a8"/);
  const old = htmlAt('/docs/versions/0.1.0/source-13f51a8');
  assert.doesNotMatch(old, /href="\/docs\/versions\/0\.1\.0\/source-13f51a8\/server\/modules\/"/);
  assert.equal(existsSync(path.join(out, 'versions/0.1.0/source-13f51a8/server/modules/index.html')), false);
});
