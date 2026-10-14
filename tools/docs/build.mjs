// Builds sboxns.com/docs/ from the server and library repositories.
//
//   node build.mjs [--server-ref latest|vX.Y.Z|branch] [--library-ref main|tag]
//
// Reads both repositories at a pinned commit (bare clones under .cache/), renders their
// Markdown guides with the site's own chrome, generates the HTTP API reference from the
// server's route definitions (cross-checked against the parity corpus) and the C# reference
// from the library's public API, and writes static HTML plus a search index under /docs/.
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { ensureBareClone, resolveRef, readFileAt, listFilesAt } from './lib/git.mjs';
import { extractRoutes, crossCheckCorpus } from './lib/server-api.mjs';
import { parseCSharp } from './lib/csharp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '../..');
const out = path.join(site, 'docs');
const cacheDir = path.join(here, '.cache');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const SERVER = { name: 'server', repo: 'sbox-cool/sbox-network-storage-server', ref: opt('--server-ref', 'latest') };
const LIBRARY = { name: 'library', repo: 'sbox-cool/sbox-network-storage', ref: opt('--library-ref', 'main') };
for (const r of [SERVER, LIBRARY]) {
  r.dir = ensureBareClone({ name: r.name, url: `https://github.com/${r.repo}.git`, cacheDir });
  Object.assign(r, resolveRef(r.dir, r.ref));
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
const PAGES = [
  ['start/connect-a-game', SERVER, 'docs/client-setup.md', 'Connect a game', 'start', 'Point the game library at your server: project, public key and base URL.'],
  ['start/game-client', SERVER, 'docs/game-client.md', 'Game client startup', 'start', 'What the library sends at startup: revision init, heartbeats and compatibility headers.'],
  ['library/overview', LIBRARY, 'README.md', 'Library overview', 'library', 'Install the library, configure credentials and call endpoints from game code.'],
  ['library/source-authoring', LIBRARY, 'source-authoring.md', 'Authoring collections and endpoints', 'library', 'YAML sources for collections, endpoints and workflows, synced by the editor tool.'],
  ['library/examples', LIBRARY, 'Examples/README.md', 'Examples', 'library', 'Example sources you can copy into a project.'],
  ['server/self-hosting', SERVER, 'docs/self-hosting.md', 'Self-hosting', 'server', 'Install, update, back up and run the server on Linux, macOS, Windows or Docker.'],
  ['server/hosting-models', SERVER, 'docs/hosting-models.md', 'Hosting models', 'server', 'Player-hosted, P2P and dedicated servers, and what the backend checks in each.'],
  ['server/configuration', SERVER, 'docs/configuration.md', 'Configuration', 'server', 'Every server.toml setting and environment variable.'],
  ['server/database', SERVER, 'docs/database.md', 'Databases', 'server', 'SQLite and PostgreSQL, migrations, backups and rollback.'],
  ['server/admin-panel', SERVER, 'docs/admin-panel.md', 'Owner console', 'server', 'The web dashboard: login, projects, records, keys and security.'],
  ['server/export', SERVER, 'docs/export.md', 'Export and move projects', 'server', 'Portable archives and moving a project between servers.'],
  ['server/modules', SERVER, 'docs/modules.md', 'Modules', 'server', 'Optional server modules and how to enable them.'],
  ['server/monitoring', SERVER, 'docs/monitoring.md', 'Monitoring', 'server', 'Health, metrics and logs.'],
  ['server/alerting', SERVER, 'docs/alerting.md', 'Alerting', 'server', 'Email and webhook alerts for errors, updates and certificates.'],
  ['server/mcp', SERVER, 'docs/mcp.md', 'Coding agents (MCP)', 'server', 'Let coding agents operate your server through MCP.'],
  ['compat/compatibility', SERVER, 'docs/compatibility.md', 'Library and server compatibility', 'compat', 'How server updates keep published games working.'],
  ['compat/version-policy', SERVER, 'docs/version-policy.md', 'Version policy', 'compat', 'Library version reporting and opt-in minimums.'],
  ['compat/certification', LIBRARY, 'docs/compatibility-certification.md', 'Library certification', 'compat', 'How a library and server pairing is tested and recorded.'],
];
const GENERATED = [
  ['api', 'HTTP API reference', 'api', 'Every game-facing route: method, path, headers, bodies and status codes, checked against the HTTP contract tests.'],
  ['library/api', 'C# API reference', 'library', 'Public types and members of the game library, from its source and XML docs.'],
];

const urlOf = (slug) => `/docs/${slug}/`;
// Source file -> docs URL, for rewriting Markdown links between guides.
const routedFiles = new Map(PAGES.map(([slug, repo, file]) => [`${repo.name}:${file}`, urlOf(slug)]));

// ---------------------------------------------------------------------------------------------
// HTML helpers.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (text) => text.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');

function navHtml(current) {
  const groups = SECTIONS.map((s) => {
    const items = [...PAGES.filter((p) => p[4] === s.id).map(([slug, , , title]) => [slug, title]),
      ...GENERATED.filter((g) => g[2] === s.id).map(([slug, title]) => [slug, title])];
    const links = items.map(([slug, title]) => `<a href="${urlOf(slug)}"${slug === current ? ' aria-current="page"' : ''}>${esc(title)}</a>`).join('');
    return `<p class="doc-nav-h">${esc(s.title)}</p>${links}`;
  });
  return `<nav class="doc-nav docs-nav" aria-label="Documentation"><a href="/docs/"${current === '' ? ' aria-current="page"' : ''}>Docs home</a>${groups.join('')}</nav>`;
}

const MAIN_LINKS = (docsCurrent) => `<a href="/#how">How it works</a><a href="/#use-cases">Use cases</a><a href="/install/">Install</a><a href="/docs/"${docsCurrent ? ' aria-current="page"' : ''}>Docs</a><a href="https://github.com/sbox-cool/sbox-network-storage-server">GitHub</a>`;

function layout({ slug, title, description, body, crumbs, source }) {
  const canonical = `https://sboxns.com${slug === '' ? '/docs/' : urlOf(slug)}`;
  const crumbHtml = [`<a href="/">Home</a>`, `<a href="/docs/">Docs</a>`, ...crumbs]
    .join('<span aria-hidden="true">/</span>');
  const sourceHtml = source
    ? `<p class="doc-source">Generated from <a href="${source.url}">${esc(source.label)}</a> at <code>${esc(source.ref)}</code> (${esc(source.commit.slice(0, 7))}).</p>`
    : '';
  return `<!doctype html>
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
<nav class="mobile-menu" id="mobile-menu" aria-label="Main" hidden>${MAIN_LINKS(true)}<a href="https://demo.sboxns.com">Live demo</a></nav>
<main id="main" class="wrap doc docs">
${navHtml(slug)}
<div class="docs-body">
  <div class="docs-search" role="search"><label class="sr-only" for="docs-q">Search the docs</label><input id="docs-q" type="search" placeholder="Search the docs" autocomplete="off"><div class="docs-results" id="docs-results" hidden></div></div>
  <nav class="crumbs" aria-label="Breadcrumb">${crumbHtml}<span aria-hidden="true">/</span><span aria-current="page">${esc(title)}</span></nav>
  <article class="prose docs-prose">
${body}
  </article>
  ${sourceHtml}
</div>
</main>
<footer class="foot"><div class="wrap">
  <div><a class="brand" href="/"><img src="/images/icon.svg" alt="" width="28" height="28">Network Storage <small>for s&amp;box</small></a>
  <p>Open-source (AGPL-3.0) and pre-1.0. These docs are generated from the server and library repositories.</p></div>
  <nav aria-labelledby="f-product"><h2 id="f-product">Product</h2><a href="https://demo.sboxns.com">Live demo</a><a href="/install/">Install</a><a href="https://github.com/sbox-cool/sbox-network-storage-server/releases">Releases</a><a href="https://github.com/sbox-cool/sbox-network-storage-server">Source on GitHub</a></nav>
  <nav aria-labelledby="f-docs"><h2 id="f-docs">Docs</h2><a href="/docs/start/connect-a-game/">Connect a game</a><a href="/docs/api/">HTTP API</a><a href="/docs/library/api/">C# API</a><a href="/docs/server/self-hosting/">Self-hosting</a></nav>
  <nav aria-labelledby="f-trust"><h2 id="f-trust">Trust</h2><a href="/install/#boundaries">Data boundaries</a><a href="https://sboxcool.com/privacy">Privacy</a><a href="https://sboxcool.com/network-storage/hosted-names/acceptable-use">Acceptable use</a><a href="https://sboxcool.com/support">Support</a></nav>
</div></footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------------------------
// Markdown with link rewriting and stable heading ids.
function markdown(repo, file) {
  const dir = path.posix.dirname(file);
  const used = new Map();
  const headings = [];
  const resolveHref = (href) => {
    if (!href || /^(https?:|mailto:|#)/.test(href)) return href;
    const [target, hash] = href.split('#');
    const abs = path.posix.normalize(path.posix.join(dir, target)).replace(/^\.\//, '');
    const routed = routedFiles.get(`${repo.name}:${abs}`);
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
        return text.replace(/(src|href)="(?!https?:|#|mailto:|\/)([^"]+)"/g, (_, attr, value) =>
          `${attr}="${attr === 'src' ? repo.raw(path.posix.normalize(path.posix.join(dir, value))) : resolveHref(value)}"`);
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
  const files = listFilesAt(SERVER.dir, SERVER.commit, 'src/SboxNetworkStorage.Server/Endpoints')
    .filter((f) => f.endsWith('.cs'))
    .map((f) => ({ path: f, text: SERVER.read(f) }));
  const { routes, skipped } = extractRoutes(files);
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
<li><strong>Client identity headers</strong> such as <code>x-ns-library-version</code> and <code>x-ns-client-type</code> are diagnostics, not authentication. See <a href="/docs/compat/compatibility/">compatibility</a>.</li>
</ul>
<p>Errors use one envelope: <code>{"ok": false, "error": {"code": "...", "message": "..."}}</code>. Paths below use <code>{projectId}</code>-style placeholders; examples use the test variables (<code>\${projectId}</code>, <code>\${publicKey}</code>).</p>
<nav class="api-index" aria-label="Route groups">${order.map((g) => `<a href="#${slugify(g)}">${esc(GROUP_TITLES[g] ?? g)}</a>`).join('')}</nav>`;
  return { html: intro + '\n' + sections, routes, stepCount };
}

// ---------------------------------------------------------------------------------------------
// C# API reference.
function buildCSharp() {
  const files = listFilesAt(LIBRARY.dir, LIBRARY.commit, 'Code').filter((f) => f.endsWith('.cs') && !f.includes('/obj/'));
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
  return { html: start + '\n' + body, typeCount: types.length };
}

// ---------------------------------------------------------------------------------------------
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const search = [];
const write = (slug, html) => {
  const dir = slug === '' ? out : path.join(out, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), html);
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

const api = buildApi();
write('api', layout({
  slug: 'api', title: 'HTTP API reference', description: GENERATED[0][3], crumbs: ['<span>HTTP API</span>'],
  body: `<h1>HTTP API reference</h1>\n${api.html}`,
  source: { url: SERVER.blob('src/SboxNetworkStorage.Server/Endpoints'), label: `${SERVER.repo} Endpoints + tests/parity/corpus`, ref: SERVER.ref, commit: SERVER.commit },
}));
search.push({ t: 'HTTP API reference', u: '/docs/api/', s: 'HTTP API', h: api.routes.map((r) => `${r.method} ${r.template}`).join(' | '), x: 'authentication public key secret key x-public-key x-api-key error envelope' });
for (const r of api.routes) search.push({ t: `${r.method} ${r.template}`, u: `/docs/api/#${slugify(`${r.method} ${r.template}`)}`, s: 'HTTP API', h: '', x: '' });

const cs = buildCSharp();
write('library/api', layout({
  slug: 'library/api', title: 'C# API reference', description: GENERATED[1][3], crumbs: ['<span>Game library</span>'],
  body: `<h1>C# API reference</h1>\n${cs.html}`,
  source: { url: LIBRARY.blob('Code'), label: `${LIBRARY.repo}/Code`, ref: LIBRARY.ref, commit: LIBRARY.commit },
}));
search.push({ t: 'C# API reference', u: '/docs/library/api/', s: 'Game library', h: '', x: plain(cs.html).slice(0, 3000) });

// Docs home.
const cards = SECTIONS.map((s) => {
  const items = [...PAGES.filter((p) => p[4] === s.id).map(([slug, , , title, , d]) => [slug, title, d]),
    ...GENERATED.filter((g) => g[2] === s.id).map(([slug, title, , d]) => [slug, title, d])];
  return `<section class="doc-sec" id="${s.id}"><h2>${esc(s.title)}</h2><div class="docs-cards">${items.map(([slug, title, d]) => `<a class="card docs-card" href="${urlOf(slug)}"><strong>${esc(title)}</strong><span>${esc(d)}</span></a>`).join('')}</div></section>`;
}).join('\n');
write('', layout({
  slug: '', title: 'Documentation', description: 'Network Storage documentation: connect a game, the C# library, the HTTP API and self-hosting, generated from the source repositories.',
  crumbs: [],
  body: `<h1>Documentation</h1>\n<p class="lead">Connect your s&amp;box game, call your backend from the C# library or plain HTTP, and run the server yourself. Generated from <a href="https://github.com/${SERVER.repo}">the server</a> at <code>${esc(SERVER.ref)}</code> and <a href="https://github.com/${LIBRARY.repo}">the library</a> at <code>${esc(LIBRARY.ref)}</code>.</p>\n${cards}`,
  source: null,
}).replace('<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span><a href="/docs/">Docs</a><span aria-hidden="true">/</span>', '<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">/</span>'));

writeFileSync(path.join(out, 'search-index.json'), JSON.stringify(search));
writeFileSync(path.join(out, 'search.js'), readFileSync(path.join(here, 'assets/search.js')));
writeFileSync(path.join(out, 'docs.css'), readFileSync(path.join(here, 'assets/docs.css')));
writeFileSync(path.join(out, 'sources.json'), JSON.stringify({
  server: { repo: SERVER.repo, ref: SERVER.ref, commit: SERVER.commit },
  library: { repo: LIBRARY.repo, ref: LIBRARY.ref, commit: LIBRARY.commit },
}, null, 2) + '\n');

// sitemap.xml and llms.txt list every doc page.
const pageUrls = ['/docs/', ...GENERATED.map(([slug]) => urlOf(slug)), ...PAGES.map(([slug]) => urlOf(slug))];
const sitemapPath = path.join(site, 'sitemap.xml');
let sitemap = readFileSync(sitemapPath, 'utf8').replace(/\s*<url><loc>https:\/\/sboxns\.com\/docs\/[^<]*<\/loc><\/url>/g, '');
sitemap = sitemap.replace('</urlset>', pageUrls.map((u) => `  <url><loc>https://sboxns.com${u}</loc></url>`).join('\n') + '\n</urlset>');
writeFileSync(sitemapPath, sitemap);
const llmsPath = path.join(site, 'llms.txt');
const llms = readFileSync(llmsPath, 'utf8').replace(/\n## Docs\n[\s\S]*?(?=\n## |$)/, '');
const docList = ['', '## Docs', '', ...[['', 'Documentation home'], ...GENERATED.map(([s, t]) => [s, t]), ...PAGES.map(([s, , , t]) => [s, t])]
  .map(([s, t]) => `- [${t}](https://sboxns.com${s === '' ? '/docs/' : urlOf(s)})`)].join('\n');
writeFileSync(llmsPath, llms.trimEnd() + '\n' + docList + '\n');
console.log(`Wrote ${pageUrls.length} pages to ${path.relative(site, out)}/`);
