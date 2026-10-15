import { identityKey, inventoryDigest } from '../../docs/lib/certification.mjs';

const MAIN_PROFILES = ['game/sqlite', 'game/postgres', 'editor/sqlite'];
const PAIR_PROFILES = ['game/sqlite', 'game/postgres'];
export function verifiedCertificates(records) {
  if (!Array.isArray(records)) throw new Error('Expected validation record array');
  return records.filter(record => {
    if (identityKey(record.identity) !== record.key) throw new Error('Validation record identity/key mismatch');
    if (!Array.isArray(record.methods) || !record.methods.length || new Set(record.methods.map(method => method.method)).size !== record.methods.length || inventoryDigest(record.methods.map(method => method.method)) !== record.identity.suite.inventorySha256) throw new Error('Validation method inventory mismatch');
    if (!Array.isArray(record.evidence) || !record.evidence.length || record.evidence.some(url => typeof url !== 'string' || !url.startsWith('https://'))) throw new Error('Validation evidence is missing');
    const allPass = record.methods.every(method => method.result === 'pass' && method.scenarios?.length && method.scenarios.every(scenario => scenario.result === 'pass'));
    if (record.result === 'pass' && !allPass) throw new Error('A partial/skipped method list cannot claim a complete pass');
    return record.result === 'pass' && allPass;
  });
}
const missing = (profiles, certificates) => profiles.filter(profile => !certificates.some(certificate => `${certificate.identity.clientMode}/${certificate.identity.database}` === profile));
export function buildFindings(state, records) {
  const certificates = verifiedCertificates(records);
  const head = state.library.head.commit;
  const request = state.validationRequest;
  if (!/^[a-f0-9]{40}$/.test(head) || !/^[a-f0-9]{40}$/.test(request?.serverCommit ?? '') || !/^[1-9]\d*$/.test(request.libraryRevision ?? '')) throw new Error('Exact release reconciliation identities are required');
  const sourceMissing = missing(MAIN_PROFILES, certificates.filter(certificate => certificate.identity.library.commit === head));
  const pairMissing = missing(PAIR_PROFILES, certificates.filter(certificate => certificate.identity.server.commit === request.serverCommit && certificate.identity.library.revision === request.libraryRevision && certificate.identity.library.compilation === 'published-package'));
  const explanation = '\n\nA successful subset, HTTP replay, another source commit/revision or source-recompiled package does not establish complete published-package validation. Evidence remains scoped to its recorded artifacts, engine, OS and security mode. Signed release distribution, dedicated/editor and other configurations need their own evidence.\n\nRecords: https://sboxns.com/docs/versions/#validation\nPolicy: https://github.com/sbox-cool/sbox-network-storage-server/blob/main/docs/compatibility.md\nRelated: https://github.com/sbox-cool/sbox-network-storage-server/issues/57';
  return [
    { key: 'library-main:sbox-cool/sbox-network-storage', category: 'untested-build', active: sourceMissing.length > 0,
      title: 'Validate the current library main build against the server',
      body: `Source: https://github.com/sbox-cool/sbox-network-storage/commit/${head}\n\nExact library head: \`${head}\`. A GitHub update is not a package publication receipt.\n\nMissing complete source validation profiles: ${sourceMissing.length ? sourceMissing.map(profile => '`' + profile + '`').join(', ') : 'none in this policy profile'}.\n\nRetest the affected behavior and all inventoried methods; record exact-head native evidence before describing this source build as validated.` + explanation },
    { key: `pair:${request.serverCommit}:${request.libraryRevision}`, category: 'untested-build', active: pairMissing.length > 0,
      title: `Validate server ${request.serverRef} with sbox package revision ${request.libraryRevision}`,
      body: `Server: https://github.com/sbox-cool/sbox-network-storage-server/commit/${request.serverCommit}\n\nPackage: https://sbox.game/sboxcool/network-storage\n\nExact pairing: server \`${request.serverRef}\` / \`${request.serverCommit}\`, published package revision \`${request.libraryRevision}\`.\n\nMissing complete published-package runtime profiles: ${pairMissing.length ? pairMissing.map(profile => '`' + profile + '`').join(', ') : 'none in this policy profile'}.\n\nThe issue must not be resolved by matching only a version string or by a partial/source-recompiled smoke run.` + explanation },
  ];
}
