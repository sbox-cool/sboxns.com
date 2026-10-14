// Certification is evidence for one exact build/environment, never a version-range inference.
import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = (value, length, field) => {
  if (typeof value !== 'string' || !new RegExp(`^[a-f0-9]{${length}}$`).test(value)) throw new Error(`Invalid ${field}`);
};
const text = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${field}`);
};

export function validateIdentity(identity) {
  for (const field of ['version', 'kind']) text(identity.server?.[field], `server.${field}`);
  sha(identity.server.commit, 40, 'server.commit');
  sha(identity.server.artifactSha256, 64, 'server.artifactSha256');
  if (identity.library?.commit !== null) sha(identity.library?.commit, 40, 'library.commit');
  sha(identity.library?.manifestSha256, 64, 'library.manifestSha256');
  sha(identity.library?.artifactSha256, 64, 'library.artifactSha256');
  if (!['published-package', 'published-source-recompiled'].includes(identity.library.compilation)) throw new Error('Missing library compilation provenance');
  if (!/^[1-9]\d*$/.test(identity.library.revision ?? '')) throw new Error('Missing published library revision');
  sha(identity.suite?.commit, 40, 'suite.commit');
  sha(identity.suite.inventorySha256, 64, 'suite.inventorySha256');
  for (const field of ['engineBuild', 'os', 'database', 'clientMode', 'securityMode']) text(identity[field], field);
  if (!['sqlite', 'postgres'].includes(identity.database)) throw new Error('Unsupported certification database');
  if (!['editor', 'game', 'dedicated'].includes(identity.clientMode)) throw new Error('Unsupported client mode');
  return identity;
}

// Fixed ordering makes the key independent of JSON property insertion order.
export function identityKey(identity) {
  validateIdentity(identity);
  return digest([
    identity.server.version, identity.server.kind, identity.server.commit, identity.server.artifactSha256,
    identity.library.commit, identity.library.revision, identity.library.manifestSha256, identity.library.artifactSha256, identity.library.compilation,
    identity.engineBuild, identity.os, identity.database, identity.clientMode, identity.securityMode,
    identity.suite.commit, identity.suite.inventorySha256,
  ]);
}

export function certify(expected, report, inventory) {
  const key = identityKey(expected);
  if (identityKey(report.identity) !== key) throw new Error('Tested build/environment does not match the requested pairing');
  if (!Array.isArray(inventory) || !inventory.length || inventory.some(id => typeof id !== 'string' || !id.trim()) || new Set(inventory).size !== inventory.length) throw new Error('Method inventory must contain unique full method signatures');
  if (digest([...inventory].sort()) !== expected.suite.inventorySha256) throw new Error('Method inventory digest differs from the requested suite');
  if (report.runtime !== 'sbox-native') throw new Error('HTTP/stub/managed-only runs cannot certify a real sbox pairing');
  if (!Array.isArray(report.evidence) || !report.evidence.length || report.evidence.some(url => typeof url !== 'string' || !url.startsWith('https://'))) throw new Error('Native run needs durable HTTPS evidence links');
  if (!Number.isFinite(Date.parse(report.startedAt)) || !Number.isFinite(Date.parse(report.finishedAt)) || Date.parse(report.finishedAt) < Date.parse(report.startedAt)) throw new Error('Invalid native run timestamps');
  if (!Array.isArray(report.scenarios)) throw new Error('Native report needs per-scenario results');
  const known = new Set(inventory);
  const results = new Map(inventory.map(id => [id, []]));
  const scenarioIds = new Set();
  for (const scenario of report.scenarios) {
    text(scenario.id, 'scenario.id');
    if (scenarioIds.has(scenario.id)) throw new Error(`Duplicate scenario: ${scenario.id}`);
    scenarioIds.add(scenario.id);
    if (!['pass', 'fail', 'skipped'].includes(scenario.result)) throw new Error(`Invalid result: ${scenario.id}`);
    if (!Array.isArray(scenario.methods) || !scenario.methods.length || new Set(scenario.methods).size !== scenario.methods.length) throw new Error(`Scenario needs unique method signatures: ${scenario.id}`);
    for (const method of scenario.methods) {
      if (!known.has(method)) throw new Error(`Unknown/obsolete method in report: ${method}`);
      results.get(method).push({ scenario: scenario.id, result: scenario.result });
    }
  }
  const methods = [...results].map(([method, scenarios]) => ({
    method, scenarios,
    result: scenarios.some(s => s.result === 'fail') ? 'fail' : scenarios.some(s => s.result === 'pass') && !scenarios.some(s => s.result === 'skipped') ? 'pass' : 'not-validated',
  }));
  const result = methods.some(m => m.result === 'fail') ? 'fail' : methods.every(m => m.result === 'pass') ? 'pass' : 'incomplete';
  return { schemaVersion: 1, key, identity: expected, result, methods, evidence: report.evidence, startedAt: report.startedAt, finishedAt: report.finishedAt };
}

export function inventoryDigest(methods) {
  return digest([...methods].sort());
}
