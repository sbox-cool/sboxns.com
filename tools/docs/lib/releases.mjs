// Pure source and release reconciliation. Callers supply observed public facts; these functions decide the
// next curated manifest and reconciliation state. Pins are immutable: any conflict throws and nothing is written.
// A GitHub push or a GitHub release is never s&box package publication evidence.
export const SERVER_REPO = 'sbox-cool/sbox-network-storage-server';
export const LIBRARY_REPO = 'sbox-cool/sbox-network-storage';
export const LIBRARY_BRANCH = 'main';
const SHA = /^[a-f0-9]{40}$/;
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const STABLE_TAG = /^v(\d+\.\d+\.\d+)$/;

export function parseVersion(id) {
  const m = VERSION.exec(String(id ?? ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error(`Not a stable version: ${a} / ${b}`);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// Stable releases only: not draft, not prerelease, tagged vX.Y.Z. Returned oldest first, compared numerically.
export function stableReleases(releases) {
  if (!Array.isArray(releases)) throw new Error('Release list is not an array');
  return releases
    .filter(r => !r.draft && !r.prerelease && STABLE_TAG.test(r.tag_name ?? ''))
    .map(r => ({ tag: r.tag_name, id: r.tag_name.slice(1), publishedAt: r.published_at ?? null }))
    .sort((a, b) => compareVersions(a.id, b.id));
}

// Newest stable version. Unreleased snapshots such as `next-<sha>` are skipped: they are pinned for preview
// docs (build.mjs) and must never become the default or block a stable release from being adopted.
export function newestVersion(ids) {
  return ids.filter(id => parseVersion(id)).reduce((best, id) => (best === null || compareVersions(id, best) > 0 ? id : best), null);
}

// The short SHA id is the default. The full SHA is used only when the short id already names a different commit.
export function libraryId(commit, libraries) {
  const short = `source-${commit.slice(0, 7)}`;
  return libraries.some(l => l.id === short && l.commit !== commit) ? `source-${commit}` : short;
}

// releases: resolved stable releases [{ id, tag, commit }]; head: library main commit { commit, committedAt }.
// Returns a new manifest; the input is never mutated and existing entries are never rewritten.
export function reconcileManifest(manifest, { releases, head }) {
  if (!SHA.test(head?.commit ?? '')) throw new Error('Library head is not a full commit SHA');
  const next = structuredClone(manifest);
  const added = { servers: [], libraries: [] };
  for (const release of releases) {
    if (!SHA.test(release.commit) || !STABLE_TAG.test(release.tag) || release.tag !== `v${release.id}`) {
      throw new Error(`Invalid resolved release: ${release.tag}`);
    }
    const existing = next.servers.find(s => s.id === release.id);
    if (!existing) {
      next.servers.push({ id: release.id, label: release.id, ref: release.tag, commit: release.commit });
      added.servers.push(release.id);
    } else if (existing.ref !== release.tag || existing.commit !== release.commit) {
      throw new Error(`Refusing to re-point server ${release.id}: pinned ${existing.ref} at ${existing.commit}, but ${release.tag} now resolves to ${release.commit}`);
    }
  }
  if (!next.libraries.some(l => l.commit === head.commit)) {
    const id = libraryId(head.commit, next.libraries);
    next.libraries.push({
      id,
      label: `main source (${head.commit.slice(0, 7)})`,
      ref: head.commit,
      commit: head.commit,
      publication: { status: 'unverified', revision: null, evidence: null },
    });
    added.libraries.push(id);
  }
  // The default moves up to the newest stable server; it is never lowered by a backfilled older release.
  const newest = newestVersion(next.servers.map(s => s.id));
  if (compareVersions(newest, next.defaults.server) > 0) next.defaults.server = newest;
  return { manifest: next, added, changed: JSON.stringify(next) !== JSON.stringify(manifest) };
}

// Reference to the s&box tracker's current observation. It records what was observed, not a mapping to any source.
export function sboxObservationRef(history, file) {
  const record = history?.revisions?.find(r => r.revision === history.latestRevision);
  if (!record) throw new Error('Current s&box revision is absent from tracking history');
  return { file, latestRevision: history.latestRevision, firstObservedAt: record.firstObservedAt ?? null };
}

// publication: 'verified' only when versions.json carries evidence; 'pending' for the newest main commit awaiting
// evidence; 'unmapped' for every other unverified source. Push and publish are never equated.
// The state file is rewritten only when its content changes, so polling does not churn history.
export function buildReconciliationState(previous, { manifest, head, releases, sbox, observedAt }) {
  const candidate = manifest.libraries.find(l => l.commit === head.commit);
  if (!candidate) throw new Error('Library head is not in the manifest');
  const newest = newestVersion(releases.map(release => release.id));
  const server = releases.find(release => release.id === newest);
  if (!server) throw new Error('No stable release is available for a native validation request');
  const headObservedAt = previous?.library?.head?.commit === head.commit ? previous.library.head.observedAt : observedAt;
  const content = {
    validationRequest: { serverRef: server.tag, serverCommit: server.commit, libraryRevision: sbox.latestRevision, status: 'pending-native-validation' },
    library: {
      repo: LIBRARY_REPO,
      branch: LIBRARY_BRANCH,
      head: { commit: head.commit, committedAt: head.committedAt ?? null, observedAt: headObservedAt },
      candidate: { id: candidate.id, commit: candidate.commit },
    },
    server: {
      repo: SERVER_REPO,
      newest: newestVersion(releases.map(r => r.id)),
      releases: releases.map(r => ({ tag: r.tag, id: r.id, commit: r.commit, publishedAt: r.publishedAt ?? null })),
    },
    sbox,
    publication: manifest.libraries.map(l => {
      const verified = l.publication.status === 'verified';
      return {
        library: l.id,
        commit: l.commit,
        status: verified ? 'verified' : l.commit === head.commit ? 'pending' : 'unmapped',
        revision: verified ? l.publication.revision : null,
      };
    }),
  };
  if (previous) {
    const { schemaVersion, updatedAt, ...prior } = previous;
    if (JSON.stringify(prior) === JSON.stringify(content)) return previous;
  }
  return { schemaVersion: 1, updatedAt: observedAt, ...content };
}
