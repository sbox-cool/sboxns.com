import test from 'node:test';
import assert from 'node:assert/strict';
import { certify, identityKey, inventoryDigest } from './lib/certification.mjs';

const methods = ['Sandbox.NetworkStorage.SaveDocument(string, object)', 'Sandbox.NetworkStorage.GetDocument(string)'];
const identity = () => ({
  server: { version: '99.0.0', kind: 'self-hosted', commit: 'a'.repeat(40), artifactSha256: 'b'.repeat(64) },
  library: { commit: 'c'.repeat(40), revision: '900000001', manifestSha256: 'd'.repeat(64), artifactSha256: '1'.repeat(64), compilation: 'published-package' },
  engineBuild: 'test-engine-99', os: 'fixture-os', database: 'sqlite', clientMode: 'game', securityMode: 'no-player-auth',
  suite: { commit: 'e'.repeat(40), inventorySha256: inventoryDigest(methods) },
});
const report = () => ({ identity: identity(), runtime: 'sbox-native', startedAt: '2026-10-15T10:00:00Z', finishedAt: '2026-10-15T10:01:00Z', evidence: ['https://example.invalid/test-run'], scenarios: [{ id: 'roundtrip-fixture', methods, result: 'pass' }] });

test('only a complete, exact pairing receives a pass', () => {
  const certificate = certify(identity(), report(), methods);
  assert.equal(certificate.result, 'pass');
  assert.deepEqual(certificate.methods.map(m => m.result), ['pass', 'pass']);
  for (const mutate of [
    id => id.server.artifactSha256 = 'f'.repeat(64),
    id => id.server.commit = 'f'.repeat(40),
    id => id.library.revision = '900000002',
    id => id.library.manifestSha256 = 'f'.repeat(64),
    id => id.library.commit = 'f'.repeat(40),
    id => id.library.artifactSha256 = '2'.repeat(64),
    id => id.library.compilation = 'published-source-recompiled',
    id => id.engineBuild = 'another-engine',
    id => id.database = 'postgres',
    id => id.clientMode = 'dedicated',
    id => id.securityMode = 'player-auth',
    id => id.suite.commit = 'f'.repeat(40),
  ]) {
    const other = report();
    mutate(other.identity);
    assert.throws(() => certify(identity(), other, methods), /does not match/);
  }
});

test('unexercised or skipped methods remain incomplete; failures take precedence', () => {
  const partial = report();
  partial.scenarios[0].methods = [methods[0]];
  assert.equal(certify(identity(), partial, methods).result, 'incomplete');
  partial.scenarios.push({ id: 'read-fixture', methods: [methods[1]], result: 'skipped' });
  assert.equal(certify(identity(), partial, methods).methods[1].result, 'not-validated');
  partial.scenarios[1].result = 'fail';
  assert.equal(certify(identity(), partial, methods).result, 'fail');
});

test('a newly added API method invalidates old coverage and old inventory digests', () => {
  const extended = [...methods, 'Sandbox.NetworkStorage.DeleteDocument(string)'];
  assert.throws(() => certify(identity(), report(), extended), /inventory digest/);
  const expected = identity();
  expected.suite.inventorySha256 = inventoryDigest(extended);
  const oldCoverage = report();
  oldCoverage.identity = structuredClone(expected);
  assert.equal(certify(expected, oldCoverage, extended).result, 'incomplete');
});

test('server-only evidence, duplicate scenarios and obsolete signatures cannot certify', () => {
  const serverOnly = report();
  serverOnly.runtime = 'http-parity';
  assert.throws(() => certify(identity(), serverOnly, methods), /cannot certify/);
  const duplicate = report();
  duplicate.scenarios.push(duplicate.scenarios[0]);
  assert.throws(() => certify(identity(), duplicate, methods), /Duplicate/);
  const obsolete = report();
  obsolete.scenarios[0].methods = ['OldApi.Save()'];
  assert.throws(() => certify(identity(), obsolete, methods), /obsolete/);
});

test('pair keys do not depend on JSON key insertion order', () => {
  const id = identity();
  assert.equal(identityKey(id), identityKey(Object.fromEntries(Object.entries(id).reverse())));
});

test('candidate source evidence is bound to a Git head and cannot claim an assigned package revision', () => {
  const expected = identity();
  expected.library.compilation = 'github-source';
  expected.library.revision = null;
  const candidate = report();
  candidate.identity = structuredClone(expected);
  assert.equal(certify(expected, candidate, methods).result, 'pass');
  candidate.identity.library.revision = '900000001';
  assert.throws(() => certify(expected, candidate, methods), /must not claim/);
  candidate.identity = structuredClone(expected);
  candidate.identity.library.commit = null;
  assert.throws(() => certify(expected, candidate, methods), /library.commit/);
});
