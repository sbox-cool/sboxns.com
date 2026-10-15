import test from 'node:test';
import assert from 'node:assert/strict';
import { certify, inventoryDigest } from '../docs/lib/certification.mjs';
import { buildFindings } from './lib/findings.mjs';
const source = 'a'.repeat(40), server = 'b'.repeat(40);
const state = { library: { head: { commit: source } }, validationRequest: { serverRef: 'v99.0.0', serverCommit: server, libraryRevision: '900000001' } };
function certificate(database, mode = 'game', compilation = 'published-package', commit = source) {
  const methods = ['Fixture.Client.Save(string)'];
  const identity = { server: { version: '99.0.0', kind: 'self-hosted', commit: server, artifactSha256: 'c'.repeat(64) }, library: { commit, revision: compilation === 'github-source' ? null : '900000001', compilation, manifestSha256: 'd'.repeat(64), artifactSha256: 'e'.repeat(64) }, engineBuild: 'fixture-engine', os: 'fixture-os', database, clientMode: mode, securityMode: 'fixture-auth', suite: { commit: 'f'.repeat(40), inventorySha256: inventoryDigest(methods) } };
  return certify(identity, { identity, runtime: 'sbox-native', startedAt: '2026-10-15T00:00:00Z', finishedAt: '2026-10-15T00:01:00Z', evidence: ['https://example.invalid/fixture-native-run'], scenarios: [{ id: 'fixture-save', methods, result: 'pass' }] }, methods);
}
test('provider-specific and compilation-specific evidence cannot clear a broader published-pair issue', () => {
  assert.equal(buildFindings(state, [certificate('sqlite')])[1].active, true);
  assert.equal(buildFindings(state, [certificate('sqlite', 'game', 'published-source-recompiled'), certificate('postgres', 'game', 'published-source-recompiled')])[1].active, true);
  assert.equal(buildFindings(state, [certificate('sqlite'), certificate('postgres')])[1].active, false);
});
test('main-source issues require the exact head plus editor and both runtime providers', () => {
  assert.equal(buildFindings(state, [certificate('sqlite'), certificate('postgres')])[0].active, true);
  assert.equal(buildFindings(state, [certificate('sqlite'), certificate('postgres'), certificate('sqlite', 'editor')])[0].active, false);
  assert.equal(buildFindings(state, [certificate('sqlite', 'game', 'github-source', '1'.repeat(40)), certificate('postgres', 'game', 'github-source', '1'.repeat(40)), certificate('sqlite', 'editor', 'github-source', '1'.repeat(40))])[0].active, true);
});
test('edited pass labels cannot hide missing method coverage or a different pairing', () => {
  const forged = certificate('sqlite');
  forged.methods[0].result = 'not-validated';
  forged.methods[0].scenarios = [];
  assert.throws(() => buildFindings(state, [forged]), /partial\/skipped/);
  const wrongKey = certificate('sqlite');
  wrongKey.identity.library.revision = '900000002';
  assert.throws(() => buildFindings(state, [wrongKey]), /identity\/key/);
});
