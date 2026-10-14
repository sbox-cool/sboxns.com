// Public GitHub REST reads for release reconciliation. GITHUB_TOKEN, when provided, is sent only as the
// Authorization header to api.github.com to raise rate limits. It is never logged and never echoed in errors.
const API = 'https://api.github.com';
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_TAG_DEPTH = 3;

export function apiHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'sboxns-docs-release-reconcile',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function getJson(pathname, token) {
  const response = await fetch(`${API}${pathname}`, { headers: apiHeaders(token), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status} for ${pathname}`);
  return response.json();
}

// The exact commit at a branch head, with its committer date. Branch names are read once and then pinned by SHA.
export async function fetchBranchHead(repo, branch, token) {
  const ref = await getJson(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, token);
  if (ref.object?.type !== 'commit' || !/^[a-f0-9]{40}$/.test(ref.object.sha)) throw new Error(`Branch ${branch} did not resolve to a commit`);
  const commit = await getJson(`/repos/${repo}/commits/${ref.object.sha}`, token);
  return { commit: commit.sha, committedAt: commit.commit?.committer?.date ?? null };
}

// Every release in the repository's release list, following pagination. Filtering happens in lib/releases.mjs.
export async function fetchReleases(repo, token) {
  const releases = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await getJson(`/repos/${repo}/releases?per_page=${PAGE_SIZE}&page=${page}`, token);
    if (!Array.isArray(batch)) throw new Error(`Unexpected releases response for ${repo}`);
    releases.push(...batch);
    if (batch.length < PAGE_SIZE) return releases;
  }
  throw new Error(`More than ${MAX_PAGES * PAGE_SIZE} releases in ${repo}; refusing to guess`);
}

// Resolves a tag to the commit it names, peeling annotated tags, so every pin is a commit SHA.
export async function resolveTagCommit(repo, tag, token) {
  let object = (await getJson(`/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`, token)).object;
  for (let depth = 0; depth < MAX_TAG_DEPTH; depth++) {
    if (object?.type === 'commit' && /^[a-f0-9]{40}$/.test(object.sha)) return object.sha;
    if (object?.type !== 'tag') throw new Error(`Tag ${tag} points at unsupported object type ${object?.type}`);
    object = (await getJson(`/repos/${repo}/git/tags/${object.sha}`, token)).object;
  }
  throw new Error(`Tag ${tag} nests annotated tags too deeply`);
}
