import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileManifest, stableReleases, newestVersion, libraryId, buildReconciliationState, sboxObservationRef, compareVersions } from './lib/releases.mjs';

const sha = c => c.repeat(40);
const OLD_SERVER = sha('a');
const OLD_LIB = sha('1');
const NEW_LIB = sha('2');
const NEW_SERVER = sha('b');
const unverified = { status: 'unverified', revision: null, evidence: null };
const manifest = () => ({
  defaults: { server: '0.5.4', library: 'source-1111111' },
  servers: [
    { id: '0.5.3', label: '0.5.3', ref: 'v0.5.3', commit: sha('c') },
    { id: '0.5.4', label: '0.5.4', ref: 'v0.5.4', commit: OLD_SERVER },
  ],
  libraries: [{ id: 'source-1111111', label: '1.1.0 source (1111111)', ref: OLD_LIB, commit: OLD_LIB, publication: unverified }],
});
const release = (tag, overrides = {}) => ({ tag_name: tag, draft: false, prerelease: false, published_at: '2026-10-14T12:00:00Z', ...overrides });
const resolved = (tag, commit) => ({ id: tag.slice(1), tag, commit });
const head = commit => ({ commit, committedAt: '2026-10-15T09:00:00Z' });

test('stable releases exclude drafts, prereleases and non-release tags, and order numerically', () => {
  const list = stableReleases([
    release('v0.5.10'),
    release('v0.5.9'),
    release('v0.6.0', { prerelease: true }),
    release('v0.7.0', { draft: true }),
    release('v0.1.0-alpha'),
    release('main'),
    release('v0.5.8'),
  ]);
  assert.deepEqual(list.map(r => r.id), ['0.5.8', '0.5.9', '0.5.10']);
  assert.equal(list[0].tag, 'v0.5.8');
});

test('newest version is chosen by numeric ordering, not string ordering', () => {
  assert.equal(compareVersions('0.5.10', '0.5.9') > 0, true);
  assert.equal(newestVersion(['0.5.9', '0.5.10', '0.4.0']), '0.5.10');
  assert.equal(newestVersion([]), null);
  assert.throws(() => compareVersions('0.5', '0.5.1'), /Not a stable version/);
});

test('a new stable release is appended, the default moves to it, and existing pins are untouched', () => {
  const before = manifest();
  const { manifest: next, added, changed } = reconcileManifest(before, {
    releases: [resolved('v0.5.3', sha('c')), resolved('v0.5.4', OLD_SERVER), resolved('v0.5.5', NEW_SERVER)],
    head: head(OLD_LIB),
  });
  assert.equal(changed, true);
  assert.deepEqual(added, { servers: ['0.5.5'], libraries: [] });
  assert.deepEqual(next.servers.map(s => s.id), ['0.5.3', '0.5.4', '0.5.5']);
  assert.deepEqual(next.servers[2], { id: '0.5.5', label: '0.5.5', ref: 'v0.5.5', commit: NEW_SERVER });
  assert.deepEqual(next.servers.slice(0, 2), before.servers);
  assert.equal(next.defaults.server, '0.5.5');
  assert.equal(next.defaults.library, 'source-1111111');
  assert.deepEqual(before, manifest(), 'input manifest must not be mutated');
});

test('reconciling an already-pinned state is a no-op', () => {
  const { manifest: next, added, changed } = reconcileManifest(manifest(), {
    releases: [resolved('v0.5.3', sha('c')), resolved('v0.5.4', OLD_SERVER)],
    head: head(OLD_LIB),
  });
  assert.equal(changed, false);
  assert.deepEqual(added, { servers: [], libraries: [] });
  assert.deepEqual(next, manifest());
});

test('a moved server tag fails closed instead of re-pointing the pin', () => {
  const before = manifest();
  assert.throws(() => reconcileManifest(before, {
    releases: [resolved('v0.5.4', NEW_SERVER)],
    head: head(OLD_LIB),
  }), /Refusing to re-point server 0\.5\.4/);
  assert.deepEqual(before, manifest());
});

test('an older backfilled release never lowers the default server', () => {
  const { manifest: next, added } = reconcileManifest(manifest(), {
    releases: [resolved('v0.4.0', sha('e')), resolved('v0.5.3', sha('c')), resolved('v0.5.4', OLD_SERVER)],
    head: head(OLD_LIB),
  });
  assert.deepEqual(added.servers, ['0.4.0']);
  assert.equal(next.defaults.server, '0.5.4');
});

test('a new library main commit adds an unverified source snapshot without any publication mapping', () => {
  const before = manifest();
  const { manifest: next, added, changed } = reconcileManifest(before, {
    releases: [resolved('v0.5.3', sha('c')), resolved('v0.5.4', OLD_SERVER)],
    head: head(NEW_LIB),
  });
  assert.equal(changed, true);
  assert.deepEqual(added.libraries, ['source-2222222']);
  assert.deepEqual(next.libraries[0], before.libraries[0], 'older source IDs are immutable');
  assert.deepEqual(next.libraries[1], {
    id: 'source-2222222', label: 'main source (2222222)', ref: NEW_LIB, commit: NEW_LIB, publication: unverified,
  });
  assert.equal(next.defaults.library, 'source-1111111');
});

test('a short library id that collides with a different commit uses the full SHA', () => {
  const existing = { id: 'source-2222222', label: 'x', ref: sha('3'), commit: sha('3'), publication: unverified };
  assert.equal(libraryId(NEW_LIB, [existing]), `source-${NEW_LIB}`);
  assert.equal(libraryId(sha('4'), [existing]), 'source-4444444');
  const { manifest: next } = reconcileManifest({ ...manifest(), libraries: [...manifest().libraries, existing] }, {
    releases: [], head: head(NEW_LIB),
  });
  assert.equal(next.libraries.at(-1).id, `source-${NEW_LIB}`);
  assert.equal(next.libraries.at(-1).ref, NEW_LIB);
});

test('malformed heads and resolved releases are rejected before any state is produced', () => {
  assert.throws(() => reconcileManifest(manifest(), { releases: [], head: head('main') }), /full commit SHA/);
  assert.throws(() => reconcileManifest(manifest(), { releases: [{ id: '0.6.0', tag: 'v0.6.0', commit: 'abc' }], head: head(OLD_LIB) }), /Invalid resolved release/);
});

const observed = { observedAt: '2026-10-15T10:00:00.000Z', sbox: { file: 'sbox-revisions.json', latestRevision: '422519', firstObservedAt: '2026-10-14T22:39:55.068Z' } };
const releaseFacts = [{ id: '0.5.4', tag: 'v0.5.4', commit: OLD_SERVER, publishedAt: '2026-10-14T12:00:00Z' }];

test('state marks the newest main commit pending and older unverified sources unmapped; push is not publication', () => {
  const { manifest: next } = reconcileManifest(manifest(), { releases: [], head: head(NEW_LIB) });
  const state = buildReconciliationState(null, { manifest: next, head: head(NEW_LIB), releases: releaseFacts, ...observed });
  assert.equal(state.library.candidate.id, 'source-2222222');
  assert.deepEqual(state.publication, [
    { library: 'source-1111111', commit: OLD_LIB, status: 'unmapped', revision: null },
    { library: 'source-2222222', commit: NEW_LIB, status: 'pending', revision: null },
  ]);
  assert.equal(state.sbox.latestRevision, '422519');
});

test('verified publication is the only state that carries an s&box revision', () => {
  const m = manifest();
  m.libraries[0].publication = { status: 'verified', revision: '422519', evidence: 'https://example.invalid/release' };
  const state = buildReconciliationState(null, { manifest: m, head: head(OLD_LIB), releases: releaseFacts, ...observed });
  assert.deepEqual(state.publication, [{ library: 'source-1111111', commit: OLD_LIB, status: 'verified', revision: '422519' }]);
});

test('unchanged facts keep the previous state object; the head observation time survives a repeat', () => {
  const m = manifest();
  const first = buildReconciliationState(null, { manifest: m, head: head(OLD_LIB), releases: releaseFacts, ...observed });
  const again = buildReconciliationState(first, { manifest: m, head: head(OLD_LIB), releases: releaseFacts, observedAt: '2026-10-15T10:15:00.000Z', sbox: observed.sbox });
  assert.equal(again, first);
  assert.equal(again.updatedAt, observed.observedAt);
  const moved = buildReconciliationState(first, { manifest: m, head: head(OLD_LIB), releases: releaseFacts, observedAt: '2026-10-15T10:15:00.000Z', sbox: { ...observed.sbox, latestRevision: '422520' } });
  assert.equal(moved.updatedAt, '2026-10-15T10:15:00.000Z');
  assert.equal(moved.library.head.observedAt, observed.observedAt);
});

test('the s&box observation reference points at the current revision and fails closed when it is absent', () => {
  const history = { latestRevision: '422519', revisions: [{ revision: '310446', firstObservedAt: 'old' }, { revision: '422519', firstObservedAt: 'now' }] };
  assert.deepEqual(sboxObservationRef(history, 'sbox-revisions.json'), { file: 'sbox-revisions.json', latestRevision: '422519', firstObservedAt: 'now' });
  assert.throws(() => sboxObservationRef({ latestRevision: '1', revisions: [] }, 'f'), /absent/);
});
