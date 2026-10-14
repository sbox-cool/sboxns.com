// Observes public GitHub state, pins new stable server releases and library main commits in versions.json,
// and records reconciliation state. Uses only the public API; GITHUB_TOKEN is optional and only raises rate limits.
// Writes nothing when nothing changed. Any pin conflict throws before a file is written.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARY_BRANCH, LIBRARY_REPO, SERVER_REPO, buildReconciliationState, reconcileManifest, sboxObservationRef, stableReleases } from './lib/releases.mjs';
import { fetchBranchHead, fetchReleases, resolveTagCommit } from './lib/github-public.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(here, 'versions.json');
const statePath = path.join(here, 'release-state.json');
const sboxPath = path.join(here, 'sbox-revisions.json');
const token = process.env.GITHUB_TOKEN || undefined;

const readJson = file => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);

function writeJsonIfChanged(file, value) {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return false;
  writeFileSync(file + '.tmp', text);
  renameSync(file + '.tmp', file);
  return true;
}

const manifest = readJson(manifestPath);
const previousState = readJson(statePath);
const observedAt = new Date().toISOString();

const head = await fetchBranchHead(LIBRARY_REPO, LIBRARY_BRANCH, token);
const stable = stableReleases(await fetchReleases(SERVER_REPO, token));
const releases = [];
for (const release of stable) {
  releases.push({ ...release, commit: await resolveTagCommit(SERVER_REPO, release.tag, token) });
}

const { manifest: next, added, changed } = reconcileManifest(manifest, { releases, head });
const state = buildReconciliationState(previousState, {
  manifest: next,
  head,
  releases,
  sbox: sboxObservationRef(readJson(sboxPath), 'sbox-revisions.json'),
  observedAt,
});

const updated = [];
if (changed) {
  writeJsonIfChanged(manifestPath, next);
  updated.push('versions.json');
}
if (writeJsonIfChanged(statePath, state)) updated.push('release-state.json');

const candidate = state.library.candidate;
console.log(`Stable server releases: ${releases.map(r => r.tag).join(', ')}; newest ${state.server.newest}; default ${next.defaults.server}.`);
console.log(`Library ${LIBRARY_BRANCH} head ${head.commit} -> ${candidate.id}${added.libraries.length ? ' (new source snapshot)' : ' (already pinned)'}; s&box publication: ${state.publication.find(p => p.library === candidate.id).status}.`);
console.log(added.servers.length || added.libraries.length
  ? `Added servers: [${added.servers.join(', ')}]; libraries: [${added.libraries.join(', ')}].`
  : 'No new releases or source snapshots.');
console.log(updated.length ? `Updated: ${updated.join(', ')}.` : 'No changes.');
