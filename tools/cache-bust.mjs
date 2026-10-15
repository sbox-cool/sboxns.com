// Appends content-hash ?v= URLs to every same-origin css/js/json/image reference so a
// release busts browser and CDN caches. Idempotent: unchanged assets keep their URLs.
//
//   node tools/cache-bust.mjs [--check]
//
// Rewrites tracked *.html (except .github/ mockups) and served *.js (except tools/ sources:
// docs/*.js are build copies, rewritten after each regen). Run after editing site assets or
// regenerating docs; CI runs it on pushes to main and at the end of the docs regen.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const HASH_LEN = 10;
const VERSIONED_EXTS = new Set(['.css', '.js', '.json', '.svg', '.png', '.ico', '.webp']);
const ORIGIN = 'https://sboxns.com';

const hashOf = (file) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, HASH_LEN);

// A reference is versioned when its path (before ? and #) is a versioned asset on disk.
// Any existing query is replaced; fragments (including JS-built ones) are preserved.
const busted = (url) => {
  const m = url.match(/^((?:https:\/\/sboxns\.com)?\/[^\s'"?#]*)([\s\S]*)$/);
  if (!m) return null;
  const [, bare, rest] = m;
  const pathname = bare.startsWith(ORIGIN) ? bare.slice(ORIGIN.length) : bare;
  if (!pathname.startsWith('/')) return null;
  if (!VERSIONED_EXTS.has(path.extname(pathname))) return null;
  const file = path.join(site, decodeURIComponent(pathname));
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  const frag = (rest.match(/#[\s\S]*$/) || [''])[0];
  return `${bare}?v=${hashOf(file)}${frag}`;
};

// HTML: only real reference attributes (never prose). JS: any quoted string (code, not prose).
const bustHtml = (text) => text.replace(
  /(?:src|href|content|data-index|image)="((?:https:\/\/sboxns\.com)?\/[^"]+?)"/g,
  (m, url) => {
    const next = busted(url);
    return next ? m.replace(url, next) : m;
  },
);
const bustJs = (text) => text.replace(
  /(['"])((?:https:\/\/sboxns\.com)?\/.*?)\1/g,
  (m, quote, url) => {
    const next = busted(url);
    return next ? `${quote}${next}${quote}` : m;
  },
);

// Tracked pages and served scripts. .github/ mockups are frozen proposals; tools/ holds
// generator sources whose output is busted after each regen instead.
const isPage = (f) => f.endsWith('.html') && !f.startsWith('.github/');
const isServedScript = (f) => f.endsWith('.js') && !f.startsWith('.github/') && !f.startsWith('tools/');
const tracked = (() => {
  try {
    return execFileSync('git', ['ls-files', '*.html', '*.js'], { cwd: site, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    const out = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (['.git', '.github', 'node_modules', '.cache'].includes(name)) continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(html|js)$/.test(name)) out.push(path.relative(site, full));
      }
    };
    walk(site);
    return out;
  }
})();

const files = tracked.filter((f) => isPage(f) || isServedScript(f));
// Rewriting a served script changes its hash, which changes its referrers, so repeat
// until stable. The tree is already busted (see --check), so this usually takes one pass.
const texts = new Map(files.map((f) => [f, readFileSync(path.join(site, f), 'utf8')]));
const changed = new Set();
for (let pass = 0; pass < 5; pass++) {
  let stable = true;
  for (const f of files) {
    const before = texts.get(f);
    const after = f.endsWith('.js') ? bustJs(before) : bustHtml(before);
    if (after !== before) {
      texts.set(f, after);
      changed.add(f);
      stable = false;
    }
  }
  if (stable) break;
}
if (!CHECK) for (const f of changed) writeFileSync(path.join(site, f), texts.get(f));
const names = [...changed].sort();
console.log(`${CHECK ? 'Would bust' : 'Busted'} ${names.length} file${names.length === 1 ? '' : 's'}${names.length ? `:\n  ${names.join('\n  ')}` : '.'}`);
process.exitCode = CHECK && names.length ? 1 : 0;
