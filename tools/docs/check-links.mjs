// Checks every internal link and anchor in the generated /docs/ pages (and links into /docs/
// from the rest of the site). Exits non-zero on any broken target.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pages = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'tools'].includes(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith('.html')) pages.push(full);
  }
};
walk(site);

const ids = new Map();
const idsOf = (file) => {
  if (!ids.has(file)) ids.set(file, new Set([...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  return ids.get(file);
};
const fileFor = (urlPath) => {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const target = path.join(site, clean);
  if (clean.endsWith('/')) return path.join(target, 'index.html');
  if (existsSync(target) && statSync(target).isDirectory()) return path.join(target, 'index.html');
  return target;
};

const broken = [];
let checked = 0;
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const inDocs = page.includes(`${path.sep}docs${path.sep}`);
  for (const [, href] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|data:)/.test(href)) continue;
    if (!inDocs && !href.startsWith('/docs/')) continue;
    checked++;
    const [pathname, hash] = href.split('#');
    const target = pathname === '' ? page : fileFor(pathname.startsWith('/') ? pathname : path.posix.join(path.dirname(page).slice(site.length), pathname));
    if (!existsSync(target)) { broken.push(`${path.relative(site, page)}: ${href} (missing ${path.relative(site, target)})`); continue; }
    if (hash && target.endsWith('.html') && !idsOf(target).has(hash)) broken.push(`${path.relative(site, page)}: ${href} (no #${hash})`);
  }
}
console.log(`Checked ${checked} internal links in ${pages.length} pages`);
if (broken.length) {
  console.error(`${broken.length} broken:\n  ${broken.join('\n  ')}`);
  process.exit(1);
}
