import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { consolidateDocCanonicals } from './lib/seo.mjs';

const origin = 'https://sboxns.com';
function fixture(t, entries) {
  const site = mkdtempSync(path.join(tmpdir(), 'sboxns-seo-'));
  t.after(() => rmSync(site, { recursive: true, force: true }));
  for (const [url, article] of entries) {
    mkdirSync(path.join(site, url), { recursive: true });
    writeFileSync(path.join(site, url, 'index.html'), `<link rel="canonical" href="${origin}${url}"><meta property="og:url" content="${origin}${url}"><nav><a href="${url}">Selected version</a></nav><article class="prose docs-prose">${article}</article>`);
  }
  const html = url => readFileSync(path.join(site, url, 'index.html'), 'utf8');
  const canonical = url => html(url).match(/rel="canonical" href="([^"]+)"/)[1];
  return { site, html, canonical, pages: entries.map(([url]) => url) };
}

test('identical versioned articles consolidate to current docs without changing version navigation', t => {
  const current = '/docs/server/setup/';
  const archived = '/docs/versions/1.0/source-old/server/setup/';
  const f = fixture(t, [
    [archived, '<h1>Setup</h1><a href="/docs/versions/1.0/source-old/server/configuration/#listen">Listen</a>'],
    [current, '<h1>Setup</h1><a href="/docs/server/configuration/#listen">Listen</a>'],
  ]);
  assert.deepEqual(consolidateDocCanonicals(f.site, f.pages), [current]);
  assert.equal(f.canonical(archived), origin + current);
  assert.match(f.html(archived), /property="og:url" content="https:\/\/sboxns.com\/docs\/server\/setup\/"/);
  assert.ok(f.html(archived).includes(`<nav><a href="${archived}">`));
  assert.ok(f.html(archived).includes('href="/docs/versions/1.0/source-old/server/configuration/#listen"'));
  assert.deepEqual(consolidateDocCanonicals(f.site, f.pages), [current]);
});

test('different historical APIs, code whitespace and links to other versions remain distinct', t => {
  const current = '/docs/library/api/';
  const old = '/docs/versions/1.0/source-old/library/api/';
  const crossVersion = '/docs/versions/2.0/source-new/library/api/';
  const spacing = '/docs/versions/3.0/source-new/library/api/';
  const f = fixture(t, [
    [current, '<h1>API</h1><pre>Save( value )</pre><a href="/docs/library/guide/">Guide</a>'],
    [old, '<h1>API</h1><pre>SaveLegacy(value)</pre><a href="/docs/versions/1.0/source-old/library/guide/">Guide</a>'],
    [crossVersion, '<h1>API</h1><pre>Save( value )</pre><a href="/docs/versions/1.0/source-old/library/guide/">Guide</a>'],
    [spacing, '<h1>API</h1><pre>Save(value)</pre><a href="/docs/versions/3.0/source-new/library/guide/">Guide</a>'],
  ]);
  assert.deepEqual(new Set(consolidateDocCanonicals(f.site, f.pages)), new Set(f.pages));
  for (const url of f.pages) assert.equal(f.canonical(url), origin + url);
});

test('removed historical guides stay indexable and consolidate only at the same documentation path', t => {
  const first = '/docs/versions/1.0/source-old/server/retired/';
  const copy = '/docs/versions/2.0/source-new/server/retired/';
  const other = '/docs/library/retired/';
  const f = fixture(t, [[copy, '<h1>Retired</h1>'], [first, '<h1>Retired</h1>'], [other, '<h1>Retired</h1>']]);
  assert.deepEqual(new Set(consolidateDocCanonicals(f.site, f.pages)), new Set([other, first]));
  assert.equal(f.canonical(copy), origin + first);
  assert.equal(f.canonical(other), origin + other);
});
