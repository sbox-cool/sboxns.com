import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// Prefer the default docs for identical articles, without hiding distinct historical APIs.
// Version selectors, navigation and source provenance remain pinned to the requested snapshot.
export function consolidateDocCanonicals(site, pages) {
  const origin = 'https://sboxns.com';
  const articles = new Map();
  const canonicalPages = [];
  const ordered = [...pages].sort((a, b) => Number(a.startsWith('/docs/versions/')) - Number(b.startsWith('/docs/versions/')) || a.localeCompare(b));
  for (const url of ordered) {
    const file = path.join(site, url, 'index.html');
    const html = readFileSync(file, 'utf8');
    const article = html.match(/<article class="prose docs-prose">([\s\S]*?)<\/article>/)?.[1];
    if (!article) throw new Error(`Missing documentation article: ${url}`);
    const base = url.match(/^\/docs\/versions\/[^/]+\/[^/]+(?=\/)/)?.[0] ?? '/docs';
    const slug = url.slice(base.length);
    const content = article.replace(/\bhref="([^"]*)"/g, (attribute, href) => {
      const local = href.startsWith(origin + '/') ? href.slice(origin.length) : href;
      return local.startsWith(base + '/') ? `href="/docs/${local.slice(base.length + 1)}"` : attribute;
    });
    const key = JSON.stringify([slug, content]);
    const canonical = articles.get(key) ?? origin + url;
    if (!articles.has(key)) {
      articles.set(key, canonical);
      canonicalPages.push(url);
    }
    const updated = html
      .replace(/(<link rel="canonical" href=")[^"]*(">)/, `$1${canonical}$2`)
      .replace(/(<meta property="og:url" content=")[^"]*(">)/, `$1${canonical}$2`);
    if (updated !== html) writeFileSync(file, updated);
  }
  return canonicalPages;
}
