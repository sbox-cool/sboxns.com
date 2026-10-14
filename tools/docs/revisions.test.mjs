import test from 'node:test';
import assert from 'node:assert/strict';
import { PACKAGE, recordRevisions, revisionId, observePackageVersions } from './lib/revisions.mjs';

const record = revision => ({ revision, createdAt: '2026-10-01T12:00:00Z', engineVersion: 29, manifestUrl: 'https://example.invalid/test-manifest.json' });
const observe = (latest, revisions = [latest]) => ({ package: PACKAGE, sourceUrl: 'https://example.invalid/test-package', latestRevision: latest, revisions: revisions.map(record) });
const firstSeen = '2026-10-15T10:00:00Z';

test('a new publication is added without losing earlier observed revisions', () => {
  const old = recordRevisions(null, observe('900000001'), firstSeen);
  const next = recordRevisions(old, observe('900000002'), '2026-10-16T10:00:00Z');
  assert.equal(next.latestRevision, '900000002');
  assert.deepEqual(next.revisions.map(r => [r.revision, r.firstObservedAt]), [
    ['900000002', '2026-10-16T10:00:00Z'], ['900000001', firstSeen],
  ]);
  assert.equal(next.revisions[0].sourceCommit, undefined);
});

test('an unchanged observation does not churn the persisted tracking record', () => {
  const old = recordRevisions(null, observe('900000001'), firstSeen);
  assert.deepEqual(recordRevisions(old, observe('900000001'), '2026-10-16T10:00:00Z'), old);
});

test('a package rollback changes current revision but preserves newer history', () => {
  const old = recordRevisions(null, observe('900000002', ['900000002', '900000001']), firstSeen);
  const rolledBack = recordRevisions(old, observe('900000001'), '2026-10-16T10:00:00Z');
  assert.equal(rolledBack.latestRevision, '900000001');
  assert.deepEqual(rolledBack.revisions, old.revisions);
});

test('invalid or mismatched metadata cannot replace a good observation', () => {
  const old = recordRevisions(null, observe('900000001'), firstSeen);
  const original = structuredClone(old);
  assert.throws(() => recordRevisions(old, { ...observe('900000002'), package: 'another.library' }, firstSeen), /identity/);
  assert.throws(() => recordRevisions(old, observe('900000002', ['900000001']), firstSeen), /absent/);
  assert.throws(() => recordRevisions(old, observe('900000001', ['900000001', '900000001']), firstSeen), /Duplicate/);
  assert.deepEqual(old, original);
});

test('revision identities never lose precision or accept malformed values', () => {
  assert.equal(revisionId('9007199254740993'), '9007199254740993');
  for (const value of [Number.MAX_SAFE_INTEGER + 1, null, '1.0.309133', -1, 0, '']) assert.throws(() => revisionId(value));
});

const apiVersion = (id, overrides = {}) => ({
  Id: id, AssetVersionId: id, Created: '2026-10-01T12:00:00+00:00', EngineVersion: 29,
  ManifestUrl: `https://public.facepunch.com/sbox/package/manifest/1/${PACKAGE}/${id}?v=test`,
  ...overrides,
});

test('public API cache hashes cannot be mistaken for package identities', () => {
  const observation = observePackageVersions([apiVersion(900000001, { Hash: Number.MAX_SAFE_INTEGER + 1 })], { Version: { Id: 900000001 } });
  assert.deepEqual(observation.revisions, [{
    revision: '900000001', createdAt: '2026-10-01T12:00:00+00:00', engineVersion: 29,
    manifestUrl: `https://public.facepunch.com/sbox/package/manifest/1/${PACKAGE}/900000001?v=test`,
  }]);
});

test('inconsistent current/history responses and foreign manifests fail closed', () => {
  assert.throws(() => observePackageVersions([apiVersion(900000001)], { Version: { Id: 900000002 } }), /absent/);
  assert.throws(() => observePackageVersions([apiVersion(900000001, { AssetVersionId: 900000002 })], { Version: { Id: 900000001 } }), /identities/);
  assert.throws(() => observePackageVersions([apiVersion(900000001, { ManifestUrl: 'https://example.invalid/foreign.json' })], { Version: { Id: 900000001 } }), /manifest/);
});
