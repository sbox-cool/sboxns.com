// Curated immutable source snapshots. A documentation pairing is not compatibility certification.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBareClone, resolveRef } from './lib/git.mjs';
import { certify } from './lib/certification.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '../..');
const manifest = JSON.parse(readFileSync(path.join(here, 'versions.json'), 'utf8'));
const repos = { server: 'sbox-cool/sbox-network-storage-server', library: 'sbox-cool/sbox-network-storage' };
const previousCatalog = path.join(site, 'docs/versions.json');
if (existsSync(previousCatalog)) {
  const previous = JSON.parse(readFileSync(previousCatalog, 'utf8'));
  for (const pair of previous.versions) {
    for (const [kind, entries] of [['server', manifest.servers], ['library', manifest.libraries]]) {
      const entry = entries.find(item => item.id === pair[kind].id);
      if (!entry || entry.commit !== pair[kind].commit) throw new Error(`Cannot remove or repoint archived ${kind} ${pair[kind].id}`);
    }
  }
}
const esc = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const ids = new Set();
for (const [kind, entries] of [['server', manifest.servers], ['library', manifest.libraries]]) {
  if (!Array.isArray(entries) || !entries.length) throw new Error(`Missing ${kind} versions`);
  for (const entry of entries) {
    if (!/^[a-zA-Z0-9.-]+$/.test(entry.id) || ids.has(`${kind}:${entry.id}`)) throw new Error(`Invalid/duplicate ${kind} id: ${entry.id}`);
    ids.add(`${kind}:${entry.id}`);
    if (!/^[a-f0-9]{40}$/.test(entry.commit)) throw new Error(`Pin ${kind} ${entry.id} to a full commit`);
    if (kind === 'library') {
      const pub = entry.publication;
      if (!pub || !['unverified', 'verified'].includes(pub.status)) throw new Error(`Missing publication status: ${entry.id}`);
      if (pub.status === 'verified' && (!/^\d+$/.test(String(pub.revision ?? '')) || !/^https:\/\//.test(pub.evidence ?? ''))) throw new Error(`Verified publication requires revision and HTTPS evidence: ${entry.id}`);
      if (pub.status === 'unverified' && (pub.revision !== null || pub.evidence !== null)) throw new Error(`Unverified publication must not assert a revision: ${entry.id}`);
    }
  }
  if (!ids.has(`${kind}:${manifest.defaults[kind]}`)) throw new Error(`Missing default ${kind}`);
  const dir = ensureBareClone({ name: kind, url: `https://github.com/${repos[kind]}.git`, cacheDir: path.join(here, '.cache') });
  for (const entry of entries) {
    const actual = resolveRef(dir, entry.ref);
    if (actual.commit !== entry.commit) throw new Error(`${kind} ${entry.id} ref moved: expected ${entry.commit}, got ${actual.commit}`);
    entry.repo = repos[kind];
  }
}
const versions = manifest.servers.flatMap(server => manifest.libraries.map(library => ({
  server, library, basePath: `/docs/versions/${server.id}/${library.id}`,
})));
const selected = versions.find(v => v.server.id === manifest.defaults.server && v.library.id === manifest.defaults.library);
const contextPath = path.join(here, '.cache', 'version-context.json');
const build = (pair, snapshot) => {
  writeFileSync(contextPath, JSON.stringify({ ...pair, versions, defaultBasePath: selected.basePath }));
  execFileSync(process.execPath, [path.join(here, 'build.mjs'), '--server-ref', pair.server.commit,
    '--library-ref', pair.library.commit, '--base-path', snapshot ? pair.basePath : '/docs',
    '--version-context', contextPath, '--cached', ...(snapshot ? ['--snapshot'] : [])], { stdio: 'inherit' });
};
// Preserve existing published /docs/... links as the curated default; archives use immutable IDs.
build(selected, false);
for (const pair of versions) build(pair, true);
const out = path.join(site, 'docs');
writeFileSync(path.join(out, 'versions.json'), JSON.stringify({ defaults: manifest.defaults, versions }, null, 2) + '\n');
writeFileSync(path.join(out, 'versions.js'), readFileSync(path.join(here, 'assets/versions.js')));

const revisions = JSON.parse(readFileSync(path.join(here, 'sbox-revisions.json'), 'utf8'));
writeFileSync(path.join(out, 'sbox-revisions.json'), JSON.stringify(revisions, null, 2) + '\n');
const revisionRows = revisions.revisions.map(revision => {
  const source = manifest.libraries.find(library => library.publication.status === 'verified' && String(library.publication.revision) === revision.revision);
  const mapping = source
    ? `<a href="/docs/versions/${manifest.defaults.server}/${source.id}/">${esc(source.label)}</a>`
    : 'Not mapped to a verified source commit';
  return `<tr><td>${esc(revision.revision)}${revision.revision === revisions.latestRevision ? ' (current)' : ''}</td><td>${esc(revision.createdAt ?? 'Not reported')}</td><td>${mapping}</td></tr>`;
}).join('\n');
const revisionHistory = `<h2 id="sbox-revisions">s&amp;box package revisions</h2>
<p>Published revisions of <a href="https://sbox.game/sboxcool/network-storage"><code>sboxcool.network-storage</code></a>, tracked from the public package API. Current observed revision: <strong>${esc(revisions.latestRevision)}</strong>. <a href="${esc(revisions.sourceUrl)}">Package metadata</a> · <a href="/docs/sbox-revisions.json">Tracking records</a>.</p>
<p>A published revision is a real package identity, not proof of a GitHub source match. Only revisions with verified publication mappings link to source documentation below. Tracking retains previously observed revisions when the current revision changes.</p>
<div class="table-wrap"><table><thead><tr><th scope="col">Package revision</th><th scope="col">Published</th><th scope="col">Source documentation</th></tr></thead><tbody>${revisionRows}</tbody></table></div>`;
const evidenceRoot = path.join(here, 'evidence');
const certificates = existsSync(evidenceRoot) ? readdirSync(evidenceRoot).filter(name => statSync(path.join(evidenceRoot, name)).isDirectory()).map(name => {
  const readEvidence = file => JSON.parse(readFileSync(path.join(evidenceRoot, name, file), 'utf8'));
  return certify(readEvidence('expected.json'), readEvidence('report.json'), readEvidence('inventory.json'));
}) : [];
mkdirSync(path.join(out, 'validation'), { recursive: true });
writeFileSync(path.join(out, 'validation/index.json'), JSON.stringify(certificates, null, 2) + '\n');
const validation = `<h2 id="validation">Exact-build validation</h2>
<p>Native test evidence applies only to its exact client, server artifacts, engine, database and security mode. Incomplete means some methods remain unvalidated, even when every executed scenario passed. <a href="/docs/validation/index.json">Machine-readable results</a>.</p>` + (certificates.length ? certificates.map(certificate => {
  const identity = certificate.identity;
  const passed = certificate.methods.filter(method => method.result === 'pass').length;
  const client = identity.library.compilation === 'github-source' ? `Git source ${identity.library.commit}` : `package revision ${identity.library.revision}`;
  return `<details class="validation-details" id="validation-${certificate.key}"><summary>Server ${esc(identity.server.version)} + ${esc(client)}: ${esc(certificate.result)} (${passed}/${certificate.methods.length} methods)</summary>
<p>${esc(identity.os)}; ${esc(identity.database)}; ${esc(identity.clientMode)}; ${esc(identity.securityMode)}. Library compilation: <code>${esc(identity.library.compilation)}</code>. Source-recompiled results do not certify published code-archive loading. Source-built server artifacts do not certify a separately built release binary.</p>
<p>Server commit <code>${esc(identity.server.commit)}</code>; suite commit <code>${esc(identity.suite.commit)}</code>. Engine build: <code>${esc(identity.engineBuild)}</code>.</p>
<p>${certificate.evidence.map((url, index) => `<a href="${esc(url)}">Run evidence ${index + 1}</a>`).join(' · ')}</p>
<table><thead><tr><th scope="col">Runtime method</th><th scope="col">Result</th><th scope="col">Scenarios</th></tr></thead><tbody>${certificate.methods.map(method => `<tr><td><code>${esc(method.method)}</code></td><td>${esc(method.result)}</td><td>${method.scenarios.map(scenario => `${esc(scenario.scenario)}: ${esc(scenario.result)}`).join('<br>') || 'Not exercised'}</td></tr>`).join('')}</tbody></table></details>`;
}).join('\n') : '<p>No native pair validation has been recorded.</p>');
const rows = versions.map(v => `<tr><td>${esc(v.server.label)}</td><td>${esc(v.library.label)}</td><td>${v.library.publication.status === 'verified' ? `s&amp;box revision ${esc(v.library.publication.revision)} (<a href="${esc(v.library.publication.evidence)}">evidence</a>)` : 'GitHub source; s&amp;box publication unverified'}</td><td><a href="${v.basePath}/">Read docs</a></td></tr>`).join('\n');
const article = `<h1>Documentation versions</h1>
<p class="lead">Choose server and library source independently. Every guide, HTTP reference and C# reference in a snapshot is generated from its pinned commits.</p>
<p>These combinations let you read the two sources together. They are <strong>not certified compatibility pairings</strong>. See the selected server's compatibility guide for its policy and recorded test evidence.</p>
<h2>Finding your library build</h2>
<p>A library SemVer, GitHub commit, s&amp;box package revision and game revision are different identities. The same reported library version can cover several source commits. A repository <code>.version</code> file alone does not prove which commit s&amp;box published.</p>
<p>For a GitHub install, match the source commit. For a Library Manager install, find the installed <code>sboxcool.network-storage</code> package revision and use a mapping only when publication evidence records that exact revision and commit. If no mapping is listed here, the matching published-package docs are not verified; do not assume the newest source matches your game. Existing games retain their bundled library until republished.</p>
${revisionHistory}
${validation}
<h2>Source documentation snapshots</h2>
<div class="table-wrap"><table><thead><tr><th scope="col">Server</th><th scope="col">Library source</th><th scope="col">Publication</th><th scope="col">Documentation</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>Historical content</h2><p>Pages absent from a historical source are omitted, never replaced with today's content. The selectors retain the page when it exists; unavailable pages are marked. Stable releases from 0.1.0 onward are included. Prerelease builds are not listed.</p>`;
const home = readFileSync(path.join(out, 'index.html'), 'utf8');
const catalog = home.replace(/<article class="prose docs-prose">[\s\S]*?<\/article>/, `<article class="prose docs-prose">${article}</article>`)
  .replace(/<title>[^<]*<\/title>/, '<title>Documentation versions | Network Storage docs</title>')
  .replaceAll('https://sboxns.com/docs/"', 'https://sboxns.com/docs/versions/"');
mkdirSync(path.join(out, 'versions'), { recursive: true });
writeFileSync(path.join(out, 'versions', 'index.html'), catalog);

const pages = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name === 'index.html') pages.push('/' + path.relative(site, dir).split(path.sep).join('/') + '/');
  }
}
walk(out);
const sitemapPath = path.join(site, 'sitemap.xml');
const sitemap = readFileSync(sitemapPath, 'utf8').replace(/\s*<url><loc>https:\/\/sboxns\.com\/docs\/[^<]*<\/loc><\/url>/g, '');
writeFileSync(sitemapPath, sitemap.replace('</urlset>', pages.map(u => `  <url><loc>https://sboxns.com${u}</loc></url>`).join('\n') + '\n</urlset>'));
const llmsPath = path.join(site, 'llms.txt');
writeFileSync(llmsPath, readFileSync(llmsPath, 'utf8').trimEnd() + '\n- [Documentation versions](https://sboxns.com/docs/versions/): independent pinned server/library snapshots; package publication evidence is separate.\n');
console.log(`Built ${versions.length} source pair snapshots, ${pages.length} documentation pages.`);
