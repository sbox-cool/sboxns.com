// Builds one docs tree from the server and library repositories at pinned commits, with the site's own chrome.
//
//   node build.mjs --server-ref COMMIT --library-ref COMMIT --base-path /docs \
//     --version-context FILE [--snapshot] [--cached]
//
// --base-path         where this tree is served: /docs (default build) or /docs/versions/SERVER_ID/LIBRARY_ID
//                     (--snapshot). Every local link, canonical URL and search entry is prefixed with it.
// --version-context   JSON with the current pair and every server/library pair:
//                     { server, library, versions, defaultBasePath }. Source refs and publication status
//                     come from it; the commits must match the resolved --*-ref values.
// --snapshot          writes only --base-path (clearing just that directory) and leaves the shared root
//                     assets, sitemap.xml and llms.txt alone.
// --cached            reuses the bare clones under .cache/ without fetching.
//
// Reads Markdown guides, generates the HTTP API reference from the server's route definitions (cross-checked
// against the parity corpus) and the C# reference from the library's public API, and writes static HTML plus
// a search index. A page exists for a version only when its source exists at that version's commits; pages
// without source are omitted, never filled in from another version.
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { ensureBareClone, resolveRef, readFileAt, listFilesAt } from './lib/git.mjs';
import { extractRoutes, crossCheckCorpus } from './lib/server-api.mjs';
import { parseCSharp } from './lib/csharp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '../..');
const cacheDir = path.join(here, '.cache');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SNAPSHOT = args.includes('--snapshot');
const CACHED = args.includes('--cached');

const BASE = opt('--base-path', '/docs').replace(/\/+$/, '');
if (!/^\/docs(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(BASE)) throw new Error(`--base-path must be /docs or below it, got "${BASE}"`);
if (SNAPSHOT ? !BASE.startsWith('/docs/versions/') : BASE !== '/docs') {
  throw new Error(SNAPSHOT ? `--snapshot needs --base-path /docs/versions/SERVER/LIBRARY, got ${BASE}` : `the default build needs --base-path /docs, got ${BASE}`);
}
const out = path.join(site, BASE);

// ---------------------------------------------------------------------------------------------
// Version context: every pair the selectors can switch to, and the pair this build renders.
const contextPath = opt('--version-context', null);
if (!contextPath) throw new Error('--version-context FILE is required');
const CONTEXT = JSON.parse(readFileSync(contextPath, 'utf8'));
const VERSIONS = CONTEXT.versions;
const pairKey = (v) => `${v.server.id}|${v.library.id}`;
const pairFor = (serverId, libraryId) => VERSIONS.find((v) => v.server.id === serverId && v.library.id === libraryId);
const isCurrent = (pair) => pair.server.id === CONTEXT.server.id && pair.library.id === CONTEXT.library.id;
const CURRENT_PAIR = pairFor(CONTEXT.server.id, CONTEXT.library.id);
if (!CURRENT_PAIR) throw new Error(`context has no versions entry for ${CONTEXT.server.id} / ${CONTEXT.library.id}`);
if (SNAPSHOT && CURRENT_PAIR.basePath !== BASE) throw new Error(`--base-path ${BASE} does not match the context basePath ${CURRENT_PAIR.basePath}`);
const uniqueBy = (key) => [...new Map(VERSIONS.map((v) => [v[key].id, v[key]])).values()];

// ---------------------------------------------------------------------------------------------
// Source repositories at the pinned commits.
const cachedDir = (name) => {
  const dir = path.join(cacheDir, `${name}.git`);
  if (!existsSync(dir)) throw new Error(`--cached: ${dir} is missing; run once without --cached`);
  return dir;
};
const SERVER = { name: 'server', repo: 'sbox-cool/sbox-network-storage-server', ref: opt('--server-ref', 'latest') };
const LIBRARY = { name: 'library', repo: 'sbox-cool/sbox-network-storage', ref: opt('--library-ref', 'main') };
for (const r of [SERVER, LIBRARY]) {
  const ctx = CONTEXT[r.name];
  if (!ctx?.ref || !ctx?.commit) throw new Error(`context.${r.name} needs ref and commit`);
  if (CURRENT_PAIR[r.name].commit !== ctx.commit) throw new Error(`context.versions entry for this pair pins ${CURRENT_PAIR[r.name].commit} for ${r.name}, context.${r.name} pins ${ctx.commit}`);
  r.dir = CACHED ? cachedDir(r.name) : ensureBareClone({ name: r.name, url: `https://github.com/${r.repo}.git`, cacheDir });
  Object.assign(r, resolveRef(r.dir, r.ref));
  if (r.commit !== ctx.commit) throw new Error(`${r.repo} ${r.ref} resolves to ${r.commit}, but the context pins ${ctx.commit}`);
  r.ref = ctx.ref; // the descriptive ref from the context, not the flag value
  r.read = (file) => readFileAt(r.dir, r.commit, file);
  r.blob = (file) => `https://github.com/${r.repo}/blob/${r.commit}/${file}`;
  r.raw = (file) => `https://raw.githubusercontent.com/${r.repo}/${r.commit}/${file}`;
  console.log(`${r.repo} @ ${r.ref} (${r.commit.slice(0, 7)})`);
}

// ---------------------------------------------------------------------------------------------
// Information architecture. Each Markdown page: [slug, repo, file, title, section, summary].
const SECTIONS = [
  { id: 'start', title: 'Get started' },
  { id: 'library', title: 'Game library' },
  { id: 'api', title: 'HTTP API' },
  { id: 'server', title: 'Self-hosting' },
  { id: 'compat', title: 'Compatibility' },
];
const PAGE_DEFS = [
  ['start/connect-a-game', SERVER, 'docs/client-setup.md', 'Connect a game', 'start', 'Point the game library at your server: project, public key and base URL.'],
  ['start/game-client', SERVER, 'docs/game-client.md', 'Game client startup', 'start', 'What the library sends at startup: revision init, heartbeats and compatibility headers.'],
  ['start/game-values', SERVER, 'docs/game-values.md', 'Game values', 'start', 'Shared numbers your game and server both read: authoring, revisions and a worked anti-exploit example.'],
  ['library/overview', LIBRARY, 'README.md', 'Library overview', 'library', 'Install the library, configure credentials and call endpoints from game code.'],
  ['library/getting-started', LIBRARY, 'docs/getting-started.md', 'Install and configure', 'library', 'Install, update and configure the library; API root, generated code and dedicated server keys.'],
  ['library/runtime-api', LIBRARY, 'docs/runtime-api.md', 'Runtime guide', 'library', 'Endpoint calls, game values, encrypted requests and key pinning, compatibility status and helpers.'],
  ['library/sync-tool', LIBRARY, 'docs/sync-tool.md', 'Sync Tool', 'library', 'Keep collections, endpoints and workflows as YAML in your project and push or pull them.'],
  ['library/source-authoring', LIBRARY, 'source-authoring.md', 'Authoring collections and endpoints', 'library', 'YAML sources for collections, endpoints and workflows, synced by the editor tool.'],
  ['library/script-endpoints', SERVER, 'docs/endpoints-javascript.md', 'Script endpoints (JavaScript / TypeScript)', 'library', 'Write endpoints in YAML or JavaScript/TypeScript: sandboxed, with a shared global environment of reusable code.'],
  ['library/examples', LIBRARY, 'Examples/README.md', 'Examples', 'library', 'Example sources you can copy into a project.'],
  ['library/agent-tools', LIBRARY, 'docs/agent-tools.md', 'Coding agent tools (in engine)', 'library', 'The ns_* tools exposed through the sbox-cli MCP bridge.'],
  ['server/self-hosting', SERVER, 'docs/self-hosting.md', 'Self-hosting', 'server', 'Install, update, back up and run the server on Linux, macOS, Windows or Docker.'],
  ['server/cli', SERVER, 'docs/cli.md', 'CLI reference', 'server', 'Every sbox-ns command, grouped.'],
  ['server/hosting-models', SERVER, 'docs/hosting-models.md', 'Hosting models', 'server', 'Player-hosted, P2P and dedicated servers, and what the backend checks in each.'],
  ['server/configuration', SERVER, 'docs/configuration.md', 'Configuration', 'server', 'Every server.toml setting and environment variable.'],
  ['server/database', SERVER, 'docs/database.md', 'Databases', 'server', 'SQLite and PostgreSQL, migrations, backups and rollback.'],
  ['server/admin-panel', SERVER, 'docs/admin-panel.md', 'Owner console', 'server', 'The web dashboard: login, projects, records, keys and security.'],
  ['server/media', SERVER, 'docs/media.md', 'Media uploads', 'server', 'Player and project media, quotas and retention.'],
  ['server/game-logs', SERVER, 'docs/game-logs.md', 'Game logs', 'server', 'Structured game events per project: wire format, search and retention.'],
  ['server/export', SERVER, 'docs/export.md', 'Export and move projects', 'server', 'Portable archives and moving a project between servers.'],
  ['server/modules', SERVER, 'docs/modules.md', 'Modules', 'server', 'Optional server modules and how to enable them.'],
  ['server/monitoring', SERVER, 'docs/monitoring.md', 'Monitoring', 'server', 'Health, metrics and logs.'],
  ['server/alerting', SERVER, 'docs/alerting.md', 'Alerting', 'server', 'Email and webhook alerts for errors, updates and certificates.'],
  ['server/mcp', SERVER, 'docs/mcp.md', 'Coding agents (MCP)', 'server', 'Let coding agents operate your server through MCP.'],
  ['compat/compatibility', SERVER, 'docs/compatibility.md', 'Library and server compatibility', 'compat', 'How server updates keep published games working.'],
  ['compat/version-policy', SERVER, 'docs/version-policy.md', 'Version policy', 'compat', 'Library version reporting and opt-in minimums.'],
  ['compat/certification', LIBRARY, 'docs/compatibility-certification.md', 'Library certification', 'compat', 'How a library and server pairing is tested and recorded.'],
];
const GENERATED_DEFS = [
  ['api', 'HTTP API reference', 'api', 'Every game-facing route: method, path, headers, bodies and status codes, checked against the HTTP contract tests.'],
  ['library/api', 'C# API reference', 'library', 'Public types and members of the game library, from its source and XML docs.'],
];

// ---------------------------------------------------------------------------------------------
// Page availability per version. A page exists for a pair only when its source exists at that pair's commits.
// Context `pages` (when given) is trusted; otherwise it is derived from the git trees here.
const API_DIR = 'src/SboxNetworkStorage.Server/Endpoints';
const CSHARP_DIR = 'Code';
const treeCache = new Map();
const treeAt = (repo, commit) => {
  const key = `${repo.name}:${commit}`;
  if (!treeCache.has(key)) treeCache.set(key, new Set(listFilesAt(repo.dir, commit)));
  return treeCache.get(key);
};
const hasCsFiles = (files, dir) => [...files].some((f) => f.startsWith(`${dir}/`) && f.endsWith('.cs') && !f.includes('/obj/'));
const pagesDerivedAt = (pair) => {
  const trees = { server: treeAt(SERVER, pair.server.commit), library: treeAt(LIBRARY, pair.library.commit) };
  const available = new Set(['']);
  for (const [slug, repo, file] of PAGE_DEFS) if (trees[repo.name].has(file)) available.add(slug);
  if (hasCsFiles(trees.server, API_DIR)) available.add('api');
  if (hasCsFiles(trees.library, CSHARP_DIR)) available.add('library/api');
  return available;
};
const pagesCache = new Map();
const pagesOf = (pair) => {
  const key = pairKey(pair);
  if (!pagesCache.has(key)) pagesCache.set(key, Array.isArray(pair.pages) ? new Set(['', ...pair.pages]) : pagesDerivedAt(pair));
  return pagesCache.get(key);
};
const AVAILABLE = pagesOf(CURRENT_PAIR);
const PAGES = PAGE_DEFS.filter(([slug]) => AVAILABLE.has(slug));
const GENERATED = GENERATED_DEFS.filter(([slug]) => AVAILABLE.has(slug));
const omittedFiles = new Set(PAGE_DEFS.filter(([slug]) => !AVAILABLE.has(slug)).map(([, repo, file]) => `${repo.name}:${file}`));
for (const slug of [...PAGE_DEFS, ...GENERATED_DEFS].map(([s]) => s).filter((s) => !AVAILABLE.has(s))) {
  console.warn(`NOTE ${BASE}: omitted "${slug}", its source is not present at this version`);
}

const pageUrl = (base, slug) => (slug === '' ? `${base}/` : `${base}/${slug}/`);
const urlOf = (slug) => pageUrl(BASE, slug);
const docLink = (slug, text) => (AVAILABLE.has(slug) ? `<a href="${urlOf(slug)}">${text}</a>` : text);
// Source file -> docs URL, for rewriting Markdown links between guides.
const routedFiles = new Map(PAGES.map(([slug, repo, file]) => [`${repo.name}:${file}`, urlOf(slug)]));

// ---------------------------------------------------------------------------------------------
// HTML helpers.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (text) => text.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

const sectionItems = (id) => [
  ...PAGES.filter((p) => p[4] === id).map(([slug, , , title, , summary]) => ({ slug, title, summary })),
  ...GENERATED.filter((g) => g[2] === id).map(([slug, title, , summary]) => ({ slug, title, summary })),
];

function navHtml(current) {
  const groups = SECTIONS.map((s) => {
    const items = sectionItems(s.id);
    if (!items.length) return '';
    const links = items.map(({ slug, title }) => `<a href="${urlOf(slug)}"${slug === current ? ' aria-current="page"' : ''}>${esc(title)}</a>`).join('');
    return `<p class="doc-nav-h">${esc(s.title)}</p>${links}`;
  }).join('');
  const links = `<a href="${urlOf('')}"${current === '' ? ' aria-current="page"' : ''}>Docs home</a>${groups}`;
  // One navigation block for every width. Desktop: a sticky sidebar with the version selectors above Docs home.
  // Mobile: the same block collapses behind a "Docs menu" toggle (a CSS checkbox, so it works without JS) that shows
  // the current selection; opened, it shows the selectors above the links.
  const selection = `${esc(CONTEXT.server.label)} · ${libraryLabelHtml(CONTEXT.library)}`;
  return `<aside class="docs-side" aria-label="Documentation navigation">
  <input type="checkbox" class="docs-menu-check" id="docs-menu-check">
  <label class="docs-menu-toggle" for="docs-menu-check"><svg class="i" aria-hidden="true"><use href="/images/icons.svg#i-menu"></use></svg><span class="docs-menu-title">Docs menu</span><span class="docs-menu-current">${selection}</span><span class="chev"><svg class="i" aria-hidden="true"><use href="/images/icons.svg#i-chev"></use></svg></span></label>
  <div class="docs-menu-panel">
    ${versionHtml(current)}
    <nav class="doc-nav docs-nav" aria-label="Documentation">${links}</nav>
  </div>
</aside>`;
}

const GITHUB_URL = 'https://github.com/sbox-cool/sbox-network-storage-server';
const LIBRARY_URL = 'https://github.com/sbox-cool/sbox-network-storage';
const GITHUB_DROP = `<span class="nav-drop"><button type="button" class="nav-ico" aria-expanded="false" aria-haspopup="true" aria-label="GitHub repositories" title="GitHub"><svg class="i" aria-hidden="true"><use href="/images/icons.svg#i-github"></use></svg></button><span class="nav-drop-menu" hidden><a href="${GITHUB_URL}"><svg class="i" aria-hidden="true"><use href="/images/icons.svg#i-server"></use></svg><span>Server<small>sbox-network-storage-server</small></span></a><a href="${LIBRARY_URL}"><svg class="i" aria-hidden="true"><use href="/images/icons.svg#i-book"></use></svg><span>Frontend library<small>sbox-network-storage</small></span></a></span></span>`;
const GITHUB_MOBILE = `<a href="${GITHUB_URL}">Server source</a><a href="${LIBRARY_URL}">Frontend library source</a>`;
const DISCORD_INVITE = '/discord-invite/';
const SBOXCOOL_DISCORD = 'https://sbox.cool/discord';
const DISCORD_DROP = `<span class="nav-drop"><button type="button" class="nav-ico" aria-expanded="false" aria-haspopup="true" aria-label="Discord communities" title="Discord"><svg class="i" aria-hidden="true"><use href="/images/icons.svg#i-discord"></use></svg></button><span class="nav-drop-menu" hidden><a href="${DISCORD_INVITE}"><svg class="i" aria-hidden="true"><use href="/images/icons.svg#i-discord"></use></svg><span>Network Storage<small>sboxns.com</small></span></a><a href="${SBOXCOOL_DISCORD}"><svg class="i" aria-hidden="true"><use href="/images/icons.svg#i-discord"></use></svg><span>s&amp;box Cool<small>sbox.cool</small></span></a></span></span>`;
const DISCORD_MOBILE = `<a href="${DISCORD_INVITE}">Network Storage Discord</a><a href="${SBOXCOOL_DISCORD}">s&amp;box Cool Discord</a>`;
const MAIN_LINKS = (docsCurrent, compact = true) => `<a href="/#how">How it works</a><a href="/#use-cases">Use cases</a><a href="/install/">Install</a><a href="${urlOf('')}"${docsCurrent ? ' aria-current="page"' : ''}>Docs</a>${compact ? GITHUB_DROP + DISCORD_DROP : GITHUB_MOBILE + DISCORD_MOBILE}`;

const FOOT_DOCS = [['start/connect-a-game', 'Connect a game'], ['api', 'HTTP API'], ['library/api', 'C# API'], ['server/self-hosting', 'Self-hosting']]
  .filter(([slug]) => AVAILABLE.has(slug))
  .map(([slug, text]) => `<a href="${urlOf(slug)}">${text}</a>`)
  .join('');

// Publication state comes from the context. "Unverified" means GitHub source only, never a claimed s&box build.
const LIBRARY_PUBLICATION = (() => {
  const p = CONTEXT.library.publication;
  const short = LIBRARY.commit.slice(0, 7);
  if (p?.status === 'verified') {
    if (!p.revision || !p.evidence) throw new Error('a verified library publication needs revision and evidence');
    const evidence = /^https?:\/\//.test(p.evidence) ? `<a href="${esc(p.evidence)}">${esc(p.evidence)}</a>` : esc(p.evidence);
    return `<strong>s&amp;box publication verified</strong> as revision <code>${esc(p.revision)}</code> (evidence: ${evidence}). Source: GitHub commit <code>${short}</code>.`;
  }
  if (p?.status === 'unverified') {
    return `<strong>GitHub source; s&amp;box publication unverified.</strong> No confirmed package revision.`;
  }
  throw new Error(`library publication status must be verified or unverified, got ${p?.status}`);
})();

const sourceLine = (label, src, ctx) => `<strong>${label}:</strong> ${esc(ctx.label)} (<code>${esc(ctx.id)}</code>), GitHub source <a href="https://github.com/${src.repo}/tree/${src.commit}">${esc(src.repo)}</a> at <code>${esc(src.ref)}</code> (<code>${src.commit.slice(0, 7)}</code>).`;

// Target for a selector choice: the same page in that pair. A pair that is built but lacks the page points to
// the catalog with ?missing=SLUG&server=&library=, which explains the gap; nothing from another version is shown.
const targetFor = (pair, slug) => {
  if (!pagesOf(pair).has(slug)) {
    return `/docs/versions/?missing=${encodeURIComponent(slug)}&server=${encodeURIComponent(pair.server.id)}&library=${encodeURIComponent(pair.library.id)}`;
  }
  return pageUrl(isCurrent(pair) ? BASE : pair.basePath, slug);
};

// Library option text: a verified publication shows its s&box revision; unverified source keeps the plain label.
const libraryLabelHtml = (item) => {
  const p = item.publication;
  if (p?.status !== 'verified') return esc(item.label);
  if (!p.revision) throw new Error(`verified library publication ${item.id} needs a revision`);
  return `${esc(item.label)} · s&amp;box r${esc(p.revision)}`;
};

function versionControl(key, heading, slug, currentId, pairOf, labelHtml) {
  const options = [];
  const links = [];
  for (const item of uniqueBy(key)) {
    const pair = pairOf(item.id);
    if (!pair) {
      options.push(`<option disabled>${esc(item.label)} (not built)</option>`);
      links.push(`<li>${heading}: ${esc(item.label)} (not built)</li>`);
      continue;
    }
    const target = targetFor(pair, slug);
    const unavailable = pagesOf(pair).has(slug) ? '' : ' (page unavailable)';
    const text = `${labelHtml(item)}${unavailable}`;
    options.push(`<option value="${esc(target)}"${item.id === currentId ? ' selected' : ''}>${text}</option>`);
    links.push(`<li><a href="${esc(target)}">${heading}: ${text}</a></li>`);
  }
  return {
    select: `<div class="docs-version-field"><label for="docs-version-${key}">${heading}</label><select id="docs-version-${key}" data-doc-version="${key}">${options.join('')}</select></div>`,
    links,
  };
}

// Server and library selectors, rendered once inside the navigation. Each option is the same page in another pair.
function versionHtml(slug) {
  const server = versionControl('server', 'Server', slug, CONTEXT.server.id, (id) => pairFor(id, CONTEXT.library.id), (item) => esc(item.label));
  const library = versionControl('library', 'Library', slug, CONTEXT.library.id, (id) => pairFor(CONTEXT.server.id, id), libraryLabelHtml);
  const defaultHome = pageUrl(CONTEXT.defaultBasePath.replace(/\/+$/, ''), '');
  return `<section class="docs-versions" aria-label="Documentation versions">
    ${server.select}
    ${library.select}
    <a class="docs-version-history" href="/docs/versions/">Versions and validation</a>
    <noscript><ul class="docs-version-links">${[...server.links, ...library.links, `<li><a href="${esc(defaultHome)}">Default version</a></li>`].join('')}</ul></noscript>
  </section>`;
}

// Publication status and source commits: a footer below the article, outside the navigation.
function provenanceHtml() {
  return `<details class="docs-provenance">
  <summary>Publication and source</summary>
  <p>${LIBRARY_PUBLICATION} <a href="/docs/versions/">All versions</a></p>
  <p>${sourceLine('Server', SERVER, CONTEXT.server)} ${sourceLine('Library', LIBRARY, CONTEXT.library)}</p>
</details>`;
}

// External links leave the site in a new tab. Applied to the assembled page so
// chrome, markdown and generated API tables all behave the same.
const isExternalHref = (href) => /^https?:\/\//i.test(href) && !/^https:\/\/(?:www\.)?sboxns\.com(?=[/#?]|$)/i.test(href);
const externalize = (html) => html.replace(/<a(\s[^<>]*)?href="(https?:\/\/[^"]+)"([^<>]*)>/gi, (tag, pre, href, post) => {
  if (!isExternalHref(href) || /\btarget\s*=/i.test(tag)) return tag;
  return `<a${pre ?? ''}href="${href}"${post} target="_blank" rel="noopener">`;
});

function layout({ slug, title, description, body, crumbs, source }) {
  const canonical = `https://sboxns.com${urlOf(slug)}`;
  const trail = [`<a href="/">Home</a>`, ...(slug === '' ? [] : [`<a href="${urlOf('')}">Docs</a>`, ...crumbs])];
  const crumbHtml = trail.join('<span aria-hidden="true">/</span>');
  const sourceHtml = source
    ? `<p class="doc-source">Generated from <a href="${source.url}">${esc(source.label)}</a> at <code>${esc(source.ref)}</code> (${esc(source.commit.slice(0, 7))}).</p>`
    : '';
  const html = `<!doctype html>
<html lang="en" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} | Network Storage docs</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${canonical}">
  <meta name="theme-color" content="#08090a" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta property="og:site_name" content="sboxns.com">
  <meta property="og:title" content="${esc(title)} | Network Storage docs">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:type" content="article">
  <meta property="og:image" content="https://sboxns.com/images/social-card.png">
  <link rel="icon" type="image/svg+xml" href="/images/favicon.svg?v=lime2">
  <link rel="icon" href="/images/favicon.ico?v=lime2" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/images/favicon-32x32.png?v=lime2">
  <link rel="icon" type="image/png" sizes="16x16" href="/images/favicon-16x16.png?v=lime2">
  <link rel="apple-touch-icon" sizes="180x180" href="/images/apple-touch-icon.png?v=lime2">
  <link rel="stylesheet" href="/site.css">
  <link rel="stylesheet" href="/docs/docs.css">
  <script src="/theme.js"></script>
  <script src="/code.js" defer></script>
  <script src="/site.js" defer></script>
  <script src="/docs/search.js" defer></script>
  <script src="/docs/versions.js" defer></script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="nav"><div class="wrap">
  <a class="brand" href="/" aria-label="s&amp;box Network Storage home"><img src="/images/icon.svg" alt="" width="28" height="28">Network Storage <small>for s&amp;box</small></a>
  <nav class="links" aria-label="Main">${MAIN_LINKS(true)}</nav>
  <span class="spacer"></span>
  <div class="nav-actions">
    <button type="button" class="icon-btn theme-toggle" aria-label="Switch between dark and light theme" title="Theme"><span class="moon"><svg class="i" aria-hidden="true"><use href="/images/icons.svg#i-moon"></use></svg></span><span class="sun"><svg class="i" aria-hidden="true"><use href="/images/icons.svg#i-sun"></use></svg></span></button>
    <a class="btn sm" href="https://demo.sboxns.com"><svg class="i" aria-hidden="true"><use href="/images/icons.svg#i-play"></use></svg>Live demo</a>
    <button type="button" class="icon-btn menu-btn" aria-label="Menu" aria-expanded="false" aria-controls="mobile-menu"><span class="bars"><svg class="i" aria-hidden="true"><use href="/images/icons.svg#i-menu"></use></svg></span><span class="x"><svg class="i" aria-hidden="true"><use href="/images/icons.svg#i-x"></use></svg></span></button>
  </div>
</div></header>
<nav class="mobile-menu" id="mobile-menu" aria-label="Main" hidden>${MAIN_LINKS(true, false)}<a href="https://demo.sboxns.com">Live demo</a></nav>
<main id="main" class="wrap doc docs">
${navHtml(slug)}
<div class="docs-body">
  <div class="docs-search" role="search" data-index="${BASE}/search-index.json"><label class="sr-only" for="docs-q">Search the docs</label><input id="docs-q" type="search" placeholder="Search the docs" autocomplete="off"><div class="docs-results" id="docs-results" hidden></div></div>
  <nav class="crumbs" aria-label="Breadcrumb">${crumbHtml}<span aria-hidden="true">/</span><span aria-current="page">${esc(title)}</span></nav>
  <article class="prose docs-prose">
${body}
  </article>
  ${sourceHtml}
  ${provenanceHtml()}
</div>
</main>
<footer class="foot"><div class="wrap">
  <div><a class="brand" href="/"><img src="/images/icon.svg" alt="" width="28" height="28">Network Storage <small>for s&amp;box</small></a>
  <p>Open-source (AGPL-3.0) and pre-1.0. These docs are generated from the server and library repositories.</p></div>
  <nav aria-labelledby="f-product"><h2 id="f-product">Product</h2><a href="https://demo.sboxns.com">Live demo</a><a href="/install/">Install</a><a href="https://github.com/sbox-cool/sbox-network-storage-server/releases">Releases</a><a href="https://github.com/sbox-cool/sbox-network-storage-server">Source on GitHub</a></nav>
  <nav aria-labelledby="f-docs"><h2 id="f-docs">Docs</h2>${FOOT_DOCS}</nav>
  <nav aria-labelledby="f-trust"><h2 id="f-trust">Trust</h2><a href="/install/#boundaries">Data boundaries</a><a href="/privacy/">Privacy</a><a href="https://sboxcool.com/network-storage/hosted-names/acceptable-use">Acceptable use</a><a href="https://sboxcool.com/support">Support</a></nav>
</div></footer>
</body>
`;
  return externalize(html);
}

// ---------------------------------------------------------------------------------------------
// Markdown with link rewriting and stable heading ids.
function markdown(repo, file) {
  const dir = path.posix.dirname(file);
  const used = new Map();
  const headings = [];
  // Returns null for links to guides omitted from this version; those render as plain text.
  const resolveHref = (href) => {
    if (!href || /^(https?:|mailto:|#)/.test(href)) return href;
    if (href.startsWith('/docs/')) return BASE + href.slice('/docs'.length);
    const [target, hash] = href.split('#');
    const abs = path.posix.normalize(path.posix.join(dir, target)).replace(/^\.\//, '');
    const key = `${repo.name}:${abs}`;
    if (omittedFiles.has(key)) return null;
    const routed = routedFiles.get(key);
    if (routed) return routed + (hash ? `#${hash}` : '');
    // Cross-repo links that point at the other repository's GitHub URL stay as written.
    return repo.blob(abs) + (hash ? `#${hash}` : '');
  };
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        let id = slugify(text) || 'section';
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        if (depth >= 2 && depth <= 3) headings.push({ depth, id, text: text.replace(/<[^>]+>/g, '') });
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${text}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const target = resolveHref(href);
        if (target === null) return text;
        return `<a href="${esc(target)}"${title ? ` title="${esc(title)}"` : ''}>${text}</a>`;
      },
      image({ href, title, text }) {
        const src = /^https?:/.test(href) ? href : repo.raw(path.posix.normalize(path.posix.join(dir, href)));
        return `<img src="${esc(src)}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy">`;
      },
      code({ text, lang }) {
        const language = (lang || '').split(/\s/)[0];
        return `<pre><code${language ? ` class="language-${esc(language)}"` : ''}>${esc(text)}</code></pre>\n`;
      },
      html({ text }) {
        // Raw HTML in the sources (e.g. the README logo) keeps working with absolute asset URLs.
        return text.replace(/href="\/docs\//g, `href="${BASE}/`).replace(/(src|href)="(?!https?:|#|mailto:|\/)([^"]+)"/g, (_, attr, value) => {
          if (attr === 'src') return `src="${repo.raw(path.posix.normalize(path.posix.join(dir, value)))}"`;
          const target = resolveHref(value);
          return target === null ? 'href="#"' : `href="${target}"`;
        });
      },
    },
  });
  let source = repo.read(file);
  // The first H1 becomes the page title; drop it from the body.
  source = source.replace(/^\s*#\s+.*\n/, '');
  const html = md.parse(source);
  return { html, headings };
}

function toc(headings) {
  const h2 = headings.filter((h) => h.depth === 2);
  if (h2.length < 3) return '';
  return `<nav class="docs-toc" aria-label="On this page"><p>On this page</p>${h2.map((h) => `<a href="#${h.id}">${esc(h.text)}</a>`).join('')}</nav>`;
}

// ---------------------------------------------------------------------------------------------
// HTTP API reference.
function buildApi() {
  const files = listFilesAt(SERVER.dir, SERVER.commit, API_DIR)
    .filter((f) => f.endsWith('.cs'))
    .map((f) => ({ path: f, text: SERVER.read(f) }));
  const { routes, skipped } = extractRoutes(files);
  if (!routes.length) {
    console.log(`HTTP API: no routes defined in ${API_DIR} at ${SERVER.commit.slice(0, 7)}`);
    return { html: `<h1>HTTP API reference</h1>\n<p class="lead">No HTTP routes are defined in the pinned server source (<code>${API_DIR}</code>), so this server version has no HTTP API reference.</p>`, routes, stepCount: 0 };
  }
  const corpusFiles = listFilesAt(SERVER.dir, SERVER.commit, 'tests/parity/corpus')
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, doc: JSON.parse(SERVER.read(f)) }));
  const { matched, stepCount } = crossCheckCorpus(routes, corpusFiles);
  console.log(`HTTP API: ${routes.length} routes, ${stepCount} corpus steps, ${skipped.length} dynamic patterns skipped`);

  const groupName = (t) => {
    const s = t.replace(/^\/+/, '').split('/');
    if (s[0] === 'v3' || s[0] === 'v1' || s[0] === 'api') return `/${s[0]}/${s[1] ?? ''}`;
    return `/${s[0]}`;
  };
  const GROUP_TITLES = {
    '/v3/storage': 'Documents, records and stats', '/v3/endpoints': 'Server endpoints', '/v3/queries': 'Queries',
    '/v3/values': 'Game values', '/v3/security-config': 'Security config', '/v3/auth-sessions': 'Auth sessions',
    '/v3/sessions': 'Auth sessions (alias)', '/v3/manage': 'Management (secret key)', '/v3/server-info': 'Server info',
    '/v1/storage': 'Legacy v1 storage', '/v1/endpoints': 'Legacy v1 endpoints', '/v1/values': 'Legacy v1 game values',
    '/v1/queries': 'Legacy v1 queries', '/api/storage': 'Legacy storage alias', '/health': 'Health',
  };
  const groups = new Map();
  for (const r of routes) {
    const g = groupName(r.template);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const order = [...groups.keys()].sort((a, b) => {
    const rank = (k) => (k.startsWith('/v3/') ? 0 : k.startsWith('/v1/') || k.startsWith('/api/') ? 2 : 1);
    return rank(a) - rank(b) || a.localeCompare(b);
  });

  const libSource = (src) => {
    if (!src) return '';
    return src.split(';').map((part) => {
      const file = part.trim().split(/\s+/)[0];
      return /^Code\//.test(file) ? `<a href="${LIBRARY.blob(file)}"><code>${esc(part.trim())}</code></a>` : `<code>${esc(part.trim())}</code>`;
    }).join(', ');
  };
  const block = (value) => `<pre><code class="language-json">${esc(JSON.stringify(value, null, 2))}</code></pre>`;

  const sections = order.map((g) => {
    const items = groups.get(g).sort((a, b) => a.template.localeCompare(b.template) || a.method.localeCompare(b.method));
    const cards = items.map((r) => {
      const id = slugify(`${r.method} ${r.template}`);
      const examples = matched.get(`${r.method} ${r.template}`) ?? [];
      const statuses = [...new Set(examples.map((e) => e.step.expect?.status).filter(Boolean))].sort();
      const sources = [...new Set(examples.map((e) => e.source).filter(Boolean))];
      const first = examples.find((e) => (e.step.expect?.status ?? 0) < 300) ?? examples[0];
      let ex = '';
      if (first) {
        const s = first.step;
        const req = { method: s.method, path: s.path };
        if (s.query) req.query = s.query;
        if (s.headers) req.headers = s.headers;
        if (s.body !== undefined) req.body = s.body;
        ex = `<details class="more-info"><summary>Example from the contract tests (${esc(first.scenario)} / ${esc(s.id)})</summary><div class="prose">${block(req)}<p>Expected response status <code>${esc(s.expect?.status)}</code>${s.expect?.body ? '' : '.'}</p>${s.expect?.body ? block(s.expect.body) : ''}</div></details>`;
      }
      return `<section class="api-route" id="${id}">
<h3><span class="method m-${r.method.toLowerCase()}">${r.method}</span><code>${esc(r.template)}</code></h3>
<dl class="api-meta">
${statuses.length ? `<div><dt>Status codes in tests</dt><dd>${statuses.map((c) => `<code>${c}</code>`).join(' ')}</dd></div>` : '<div><dt>Contract tests</dt><dd>Not covered by the HTTP contract tests yet.</dd></div>'}
${sources.length ? `<div><dt>Library call</dt><dd>${sources.map(libSource).join('<br>')}</dd></div>` : ''}
<div><dt>Defined in</dt><dd><a href="${SERVER.blob(r.file)}#L${r.line}"><code>${esc(path.posix.basename(r.file))}:${r.line}</code></a></dd></div>
</dl>
${ex}
</section>`;
    }).join('\n');
    return `<h2 id="${slugify(g)}">${esc(GROUP_TITLES[g] ?? g)} <code class="group">${esc(g)}</code></h2>\n${cards}`;
  }).join('\n');

  const intro = `<p class="lead">Every game-facing route the server answers, generated from its route definitions and checked against the HTTP contract tests (${stepCount} recorded requests). The game library calls these for you; use this page when you write tools, debug traffic or build a client in another language.</p>
<h2 id="authentication">Authentication</h2>
<ul>
<li><strong>Public key</strong> (<code>sbox_ns_...</code>) in <code>x-public-key</code> or the <code>apiKey</code> query parameter: game clients. Ships inside your game.</li>
<li><strong>Player identity</strong>: <code>x-steam-id</code> plus an s&amp;box auth token in <code>x-sbox-token</code> when the project requires player authentication.</li>
<li><strong>Secret key</strong> (<code>sbox_sk_...</code>) in <code>x-api-key</code> or <code>x-secret-key</code>: editor sync, dedicated servers and management routes. Never ship it in a game build.</li>
<li><strong>Client identity headers</strong> such as <code>x-ns-library-version</code> and <code>x-ns-client-type</code> are diagnostics, not authentication. See ${docLink('compat/compatibility', 'compatibility')}.</li>
</ul>
<p>Errors use one envelope: <code>{"ok": false, "error": {"code": "...", "message": "..."}}</code>. Paths below use <code>{projectId}</code>-style placeholders; examples use the test variables (<code>\${projectId}</code>, <code>\${publicKey}</code>).</p>
<nav class="api-index" aria-label="Route groups">${order.map((g) => `<a href="#${slugify(g)}">${esc(GROUP_TITLES[g] ?? g)}</a>`).join('')}</nav>`;
  return { html: intro + '\n' + sections, routes, stepCount };
}

// ---------------------------------------------------------------------------------------------
// C# API reference.
function buildCSharp() {
  const files = listFilesAt(LIBRARY.dir, LIBRARY.commit, CSHARP_DIR).filter((f) => f.endsWith('.cs') && !f.includes('/obj/'));
  const types = files.flatMap((f) => parseCSharp(LIBRARY.read(f), f)).filter((t) => t.isPublic);
  const byFolder = new Map();
  for (const t of types) {
    const folder = path.posix.dirname(t.file).replace(/^Code\/?/, '') || 'Core';
    if (!byFolder.has(folder)) byFolder.set(folder, []);
    byFolder.get(folder).push(t);
  }
  const folders = [...byFolder.keys()].sort((a, b) => (a === 'Core' ? -1 : b === 'Core' ? 1 : a.localeCompare(b)));
  const memberHtml = (m) => `<div class="cs-member"><pre><code class="language-csharp">${esc(m.signature)}</code></pre>${m.doc.summary ? `<div class="cs-doc">${m.doc.summary}</div>` : ''}${m.doc.params.length ? `<ul class="cs-params">${m.doc.params.map((p) => `<li><code>${esc(p.name)}</code> ${p.html}</li>`).join('')}</ul>` : ''}${m.doc.returns ? `<p class="cs-returns"><strong>Returns</strong> ${m.doc.returns}</p>` : ''}</div>`;
  // NetworkStorage is a partial class spread over several folders: the Core part keeps the plain id.
  const typeIds = new Set();
  const typeId = (folder, name) => {
    const plain = slugify(name);
    let id = typeIds.has(plain) ? `${slugify(folder)}-${plain}` : plain;
    for (let n = 2; typeIds.has(id); n++) id = `${slugify(folder)}-${plain}-${n}`;
    typeIds.add(id);
    return id;
  };
  const body = folders.map((folder) => {
    const list = byFolder.get(folder).sort((a, b) => a.name.localeCompare(b.name));
    return `<h2 id="${slugify(folder)}">${esc(folder)}</h2>\n` + list.map((t) => {
      const members = t.members.filter((m) => /\bpublic\b/.test(m.signature) || t.kind === 'interface');
      const values = t.values.length ? `<ul class="cs-values">${t.values.map((v) => `<li><code>${esc(v.name)}</code>${v.doc.summary ? ` ${v.doc.summary}` : ''}</li>`).join('')}</ul>` : '';
      return `<section class="cs-type" id="${typeId(folder, t.name)}"><h3><span class="kind">${esc(t.kind)}</span> ${esc(t.name)}</h3>${t.doc.summary ? `<div class="cs-doc">${t.doc.summary}</div>` : ''}${t.doc.remarks ? `<div class="cs-doc">${t.doc.remarks}</div>` : ''}${values}${members.map(memberHtml).join('')}<p class="cs-src"><a href="${LIBRARY.blob(t.file)}#L${t.line}"><code>${esc(t.file)}:${t.line}</code></a></p></section>`;
    }).join('\n');
  }).join('\n');
  const start = `<p class="lead">Public types and members of the s&amp;box Network Storage library, generated from its source and XML documentation comments. Most games only need <a href="#networkstorage"><code>NetworkStorage</code></a>: <code>Configure</code> once, then call endpoints, documents and queries.</p>
<nav class="api-index" aria-label="Namespaces">${folders.map((f) => `<a href="#${slugify(f)}">${esc(f)}</a>`).join('')}</nav>`;
  console.log(`C# API: ${types.length} public types from ${files.length} files`);
  const html = types.length
    ? start + '\n' + body
    : `<p class="lead">No public types are defined in the pinned library source (<code>${CSHARP_DIR}/</code>), so this library version has no C# API reference.</p>`;
  return { html, typeCount: types.length };
}

// ---------------------------------------------------------------------------------------------
// The default build owns /docs/ and rebuilds it; a snapshot clears only its own base path.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const search = [];
let pageCount = 0;
const write = (slug, html) => {
  const dir = slug === '' ? out : path.join(out, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), html);
  pageCount++;
};
const plain = (html) => html.replace(/<pre[\s\S]*?<\/pre>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
const sectionTitle = (id) => SECTIONS.find((s) => s.id === id).title;

for (const [slug, repo, file, title, section, summary] of PAGES) {
  const { html, headings } = markdown(repo, file);
  write(slug, layout({
    slug, title, description: summary,
    crumbs: [`<span>${esc(sectionTitle(section))}</span>`],
    body: `<h1>${esc(title)}</h1>\n<p class="lead">${esc(summary)}</p>\n${toc(headings)}\n${html}`,
    source: { url: repo.blob(file), label: `${repo.repo}/${file}`, ref: repo.ref, commit: repo.commit },
  }));
  search.push({ t: title, u: urlOf(slug), s: sectionTitle(section), h: headings.map((h) => h.text).join(' | '), x: plain(html).slice(0, 1500) });
}

if (AVAILABLE.has('api')) {
  const api = buildApi();
  write('api', layout({
    slug: 'api', title: 'HTTP API reference', description: GENERATED_DEFS[0][3], crumbs: ['<span>HTTP API</span>'],
    body: `<h1>HTTP API reference</h1>\n${api.html}`,
    source: { url: SERVER.blob(API_DIR), label: `${SERVER.repo} ${API_DIR} + tests/parity/corpus`, ref: SERVER.ref, commit: SERVER.commit },
  }));
  search.push({ t: 'HTTP API reference', u: urlOf('api'), s: 'HTTP API', h: api.routes.map((r) => `${r.method} ${r.template}`).join(' | '), x: 'authentication public key secret key x-public-key x-api-key error envelope' });
  for (const r of api.routes) search.push({ t: `${r.method} ${r.template}`, u: `${urlOf('api')}#${slugify(`${r.method} ${r.template}`)}`, s: 'HTTP API', h: '', x: '' });
}

if (AVAILABLE.has('library/api')) {
  const cs = buildCSharp();
  write('library/api', layout({
    slug: 'library/api', title: 'C# API reference', description: GENERATED_DEFS[1][3], crumbs: ['<span>Game library</span>'],
    body: `<h1>C# API reference</h1>\n${cs.html}`,
    source: { url: LIBRARY.blob(CSHARP_DIR), label: `${LIBRARY.repo}/${CSHARP_DIR}`, ref: LIBRARY.ref, commit: LIBRARY.commit },
  }));
  search.push({ t: 'C# API reference', u: urlOf('library/api'), s: 'Game library', h: '', x: plain(cs.html).slice(0, 3000) });
}

// "New" notice: script endpoints ship in the next server release. On builds that already have the page it links
// to it; otherwise to the newest unreleased ("next-") server snapshot that has it.
const scriptEndpointsNotice = (() => {
  const text = 'Endpoints can now be written in <strong>YAML or JavaScript/TypeScript</strong> (more languages planned): a full global environment of shared code, sandboxed on your server.';
  if (AVAILABLE.has('library/script-endpoints')) return `<p class="docs-new"><strong>New:</strong> ${text} <a href="${urlOf('library/script-endpoints')}">Script endpoints</a></p>\n`;
  const versions = JSON.parse(readFileSync(path.join(here, 'versions.json'), 'utf8'));
  const next = versions.servers.find((s) => s.id.startsWith('next-'));
  if (!next) return '';
  const href = pageUrl(`/docs/versions/${next.id}/${versions.defaults.library}`, 'library/script-endpoints');
  return `<p class="docs-new"><strong>New in the next server release:</strong> ${text} <a href="${href}">Script endpoints docs (${esc(next.label)})</a></p>\n`;
})();

// Docs home.
const cards = SECTIONS.map((s) => {
  const items = sectionItems(s.id);
  if (!items.length) return '';
  return `<section class="doc-sec" id="${s.id}"><h2>${esc(s.title)}</h2><div class="docs-cards">${items.map(({ slug, title, summary }) => `<a class="card docs-card" href="${urlOf(slug)}"><strong>${esc(title)}</strong><span>${esc(summary)}</span></a>`).join('')}</div></section>`;
}).filter(Boolean).join('\n');
write('', layout({
  slug: '', title: 'Documentation', description: 'Network Storage documentation: connect a game, the C# library, the HTTP API and self-hosting, generated from the source repositories.',
  crumbs: [],
  body: `<h1>Documentation</h1>\n<p class="lead">Connect your s&amp;box game, call your backend from the C# library or plain HTTP, and run the server yourself. Generated from <a href="https://github.com/${SERVER.repo}">the server</a> at <code>${esc(SERVER.ref)}</code> and <a href="https://github.com/${LIBRARY.repo}">the library</a> at <code>${esc(LIBRARY.ref)}</code>.</p>\n${scriptEndpointsNotice}${cards}`,
  source: null,
}));

writeFileSync(path.join(out, 'search-index.json'), JSON.stringify(search));
writeFileSync(path.join(out, 'sources.json'), JSON.stringify({
  server: { repo: SERVER.repo, ref: SERVER.ref, commit: SERVER.commit },
  library: { repo: LIBRARY.repo, ref: LIBRARY.ref, commit: LIBRARY.commit },
}, null, 2) + '\n');

if (!SNAPSHOT) {
  // Shared root assets, and the global sitemap and llms.txt. Snapshot builds leave these alone.
  for (const file of ['search.js', 'docs.css', 'versions.js']) {
    writeFileSync(path.join(out, file), readFileSync(path.join(here, 'assets', file)));
  }
  // sitemap.xml and llms.txt list every doc page; /docs/versions/ entries belong to the snapshot builds and stay.
  const pageUrls = [urlOf(''), ...GENERATED.map(([slug]) => urlOf(slug)), ...PAGES.map(([slug]) => urlOf(slug))];
  const sitemapPath = path.join(site, 'sitemap.xml');
  let sitemap = readFileSync(sitemapPath, 'utf8').replace(/\s*<url><loc>https:\/\/sboxns\.com\/docs\/(?!versions\/)[^<]*<\/loc><\/url>/g, '');
  sitemap = sitemap.replace('</urlset>', pageUrls.map((u) => `  <url><loc>https://sboxns.com${u}</loc></url>`).join('\n') + '\n</urlset>');
  writeFileSync(sitemapPath, sitemap);
  const llmsPath = path.join(site, 'llms.txt');
  const llms = readFileSync(llmsPath, 'utf8').replace(/\n## Docs\n[\s\S]*?(?=\n## |$)/, '');
  const docList = ['', '## Docs', '', ...[['', 'Documentation home'], ...GENERATED.map(([s, , , ]) => [s, GENERATED_DEFS.find(([g]) => g === s)[1]]), ...PAGES.map(([s, , , t]) => [s, t])]
    .map(([s, t]) => `- [${t}](https://sboxns.com${urlOf(s)})`)].join('\n');
  writeFileSync(llmsPath, llms.trimEnd() + '\n' + docList + '\n');
}
console.log(`Wrote ${pageCount} pages to ${path.relative(site, out)}/`);
