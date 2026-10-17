// Injects the shared header/footer partials into hand-maintained pages.
// Idempotent: only the text between the shared:* markers is replaced, so
// running it twice changes nothing. Run BEFORE tools/cache-bust.mjs so the
// embedded asset URLs get fresh content hashes too.
//
//   node tools/build-pages.mjs
//
// A new page copies the marker skeleton from contact/index.html and is added
// to PAGES below. Generated docs/ keep their own footer template in
// tools/docs/build.mjs; version snapshots under docs/versions/ stay frozen.
//
// index.html keeps its homepage-only Game values links via header-home; every
// other page uses the neutral header. The per-page aria-current highlight the
// install page used to carry is intentionally dropped: one shared shell.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Hand pages only. Never docs/ (generated), docs/versions/ (frozen snapshots),
// .github/ mockups, discord-invite/ (standalone redirect) or tools/ sources.
const PAGES = [
  { file: 'index.html', header: 'header-home' },
  { file: 'install/index.html', header: 'header' },
  { file: 'privacy/index.html', header: 'header' },
  { file: 'contact/index.html', header: 'header' },
  { file: '404.html', header: 'header' },
];

const PARTIALS = {
  'header-home': 'partials/header-home.html',
  header: 'partials/header.html',
  footer: 'partials/footer.html',
};

const partials = Object.fromEntries(
  Object.entries(PARTIALS).map(([name, file]) => [name, readFileSync(path.join(site, file), 'utf8').trim()]),
);

const changed = [];
for (const page of PAGES) {
  const file = path.join(site, page.file);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    console.log(`missing (skipped): ${page.file}`);
    continue;
  }
  let next = text;
  for (const [slot, key] of [['header', page.header], ['footer', 'footer']]) {
    const pattern = new RegExp(`(<!-- shared:${slot}:start -->)[\\s\\S]*?(<!-- shared:${slot}:end -->)`);
    if (!pattern.test(next)) {
      console.log(`no ${slot} markers (skipped): ${page.file}`);
      continue;
    }
    next = next.replace(pattern, `$1\n${partials[key]}\n$2`);
  }
  if (next !== text) {
    writeFileSync(file, next);
    changed.push(page.file);
  }
}
console.log(changed.length ? `Built ${changed.length} page${changed.length === 1 ? '' : 's'}:\n  ${changed.join('\n  ')}` : 'Pages already built.');
