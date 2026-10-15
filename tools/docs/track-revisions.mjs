// Uses the same public package endpoints as Package.FetchVersions / Package.FetchAsync.
// No account, API key, package installation or inferred GitHub mapping is required.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE, PACKAGE_URL, VERSIONS_URL, observePackageVersions, recordRevisions } from './lib/revisions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, 'sbox-revisions.json');
async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Package metadata returned HTTP ${response.status}: ${url}`);
  return response.json();
}
const [versions, current] = await Promise.all([fetchJson(VERSIONS_URL), fetchJson(PACKAGE_URL)]);
const observation = observePackageVersions(versions, current);
const previousText = existsSync(target) ? readFileSync(target, 'utf8') : null;
const previous = previousText === null ? null : JSON.parse(previousText);
const history = recordRevisions(previous, observation, new Date().toISOString());
const content = JSON.stringify(history, null, 2) + '\n';
if (content !== previousText) {
  writeFileSync(target + '.tmp', content);
  renameSync(target + '.tmp', target);
}
console.log(`${PACKAGE}: current revision ${history.latestRevision}; ${observation.revisions.length} published revisions returned, ${history.revisions.length} retained. ${content === previousText ? 'No changes.' : 'Tracking history updated.'}`);
