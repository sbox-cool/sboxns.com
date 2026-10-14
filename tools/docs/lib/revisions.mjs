// Public package observations are independent of source-publication attestations.
export const PACKAGE = 'sboxcool.network-storage';
export const VERSIONS_URL = `https://public.facepunch.com/sbox/package/versions/2/${PACKAGE}`;
export const PACKAGE_URL = `https://public.facepunch.com/sbox/package/get/2/${PACKAGE}`;

export function observePackageVersions(versions, current) {
  if (!Array.isArray(versions) || !versions.length) throw new Error('Package API returned no revision history');
  const latestRevision = revisionId(current?.Version?.Id);
  const revisions = versions.map(version => {
    const revision = revisionId(version.Id);
    if (revisionId(version.AssetVersionId) !== revision) throw new Error(`Package revision identities disagree: ${revision}`);
    const expectedManifest = `https://public.facepunch.com/sbox/package/manifest/1/${PACKAGE}/${revision}`;
    if (typeof version.ManifestUrl !== 'string' || !version.ManifestUrl.startsWith(expectedManifest + '?')) throw new Error(`Unexpected manifest for revision ${revision}`);
    if (typeof version.Created !== 'string' || !Number.isFinite(Date.parse(version.Created))) throw new Error(`Missing publish date: ${revision}`);
    if (!Number.isSafeInteger(version.EngineVersion) || version.EngineVersion < 0) throw new Error(`Invalid engine version: ${revision}`);
    return { revision, createdAt: version.Created, engineVersion: version.EngineVersion, manifestUrl: version.ManifestUrl };
  });
  if (!revisions.some(revision => revision.revision === latestRevision)) throw new Error('Current package revision is absent from revision history; no observation saved');
  return { package: PACKAGE, sourceUrl: VERSIONS_URL, latestRevision, revisions };
}

export function revisionId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Unsafe numeric package revision');
  const id = String(value ?? '');
  if (!/^[1-9]\d*$/.test(id)) throw new Error(`Invalid package revision: ${id}`);
  return id;
}

export function recordRevisions(previous, observation, observedAt) {
  if (observation.package !== PACKAGE || (previous && previous.package !== PACKAGE)) throw new Error('Unexpected package identity');
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('Invalid observation time');
  if (!observation.sourceUrl?.startsWith('https://')) throw new Error('Expected HTTPS package metadata source');
  const latestRevision = revisionId(observation.latestRevision);
  const records = new Map((previous?.revisions ?? []).map(record => [revisionId(record.revision), record]));
  const seen = new Set();
  for (const record of observation.revisions) {
    const revision = revisionId(record.revision);
    if (seen.has(revision)) throw new Error(`Duplicate package revision: ${revision}`);
    seen.add(revision);
    if (record.createdAt !== null && !Number.isFinite(Date.parse(record.createdAt))) throw new Error(`Invalid publish date for ${revision}`);
    if (record.manifestUrl !== null && !record.manifestUrl.startsWith('https://')) throw new Error(`Invalid manifest URL for ${revision}`);
    const existing = records.get(revision);
    records.set(revision, {
      revision,
      createdAt: record.createdAt ?? existing?.createdAt ?? null,
      engineVersion: record.engineVersion ?? existing?.engineVersion ?? null,
      manifestUrl: record.manifestUrl ?? existing?.manifestUrl ?? null,
      firstObservedAt: existing?.firstObservedAt ?? observedAt,
    });
  }
  if (!seen.has(latestRevision)) throw new Error('Current package revision is absent from the API observation');
  return {
    package: PACKAGE,
    sourceUrl: observation.sourceUrl,
    latestRevision,
    revisions: [...records.values()].sort((a, b) => BigInt(a.revision) > BigInt(b.revision) ? -1 : BigInt(a.revision) < BigInt(b.revision) ? 1 : 0),
  };
}
