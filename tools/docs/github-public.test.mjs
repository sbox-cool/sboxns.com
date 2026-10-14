import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { apiHeaders, fetchBranchHead, fetchReleases, resolveTagCommit } from './lib/github-public.mjs';

const sha = c => c.repeat(40);
const realFetch = globalThis.fetch;

function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const pathname = new URL(url).pathname + new URL(url).search;
    calls.push({ pathname, headers: init.headers });
    const body = routes[pathname];
    if (body === undefined) return new Response('nope', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('the token is sent only as a bearer header and never appears without it', () => {
  assert.equal(apiHeaders(undefined).Authorization, undefined);
  assert.equal(apiHeaders('t0k').Authorization, 'Bearer t0k');
});

test('annotated tags are peeled to the commit they name', async () => {
  const calls = stubFetch({
    '/repos/o/r/git/ref/tags/v0.5.5': { object: { type: 'tag', sha: 'tagobj' } },
    '/repos/o/r/git/tags/tagobj': { object: { type: 'commit', sha: sha('e') } },
  });
  assert.equal(await resolveTagCommit('o/r', 'v0.5.5', 'tok'), sha('e'));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
});

test('lightweight tags resolve directly to the commit', async () => {
  stubFetch({ '/repos/o/r/git/ref/tags/v0.5.4': { object: { type: 'commit', sha: sha('d') } } });
  assert.equal(await resolveTagCommit('o/r', 'v0.5.4', undefined), sha('d'));
});

test('a non-commit tag target fails closed', async () => {
  stubFetch({ '/repos/o/r/git/ref/tags/v9.9.9': { object: { type: 'tree', sha: sha('f') } } });
  await assert.rejects(resolveTagCommit('o/r', 'v9.9.9', undefined), /unsupported object type tree/);
});

test('branch head is pinned to its commit and dated by the committer timestamp', async () => {
  stubFetch({
    '/repos/o/r/git/ref/heads/main': { object: { type: 'commit', sha: sha('1') } },
    [`/repos/o/r/commits/${sha('1')}`]: { sha: sha('1'), commit: { committer: { date: '2026-10-15T09:00:00Z' } } },
  });
  assert.deepEqual(await fetchBranchHead('o/r', 'main', undefined), { commit: sha('1'), committedAt: '2026-10-15T09:00:00Z' });
});

test('release listing follows pagination until a short page', async () => {
  const full = Array.from({ length: 100 }, (_, i) => ({ tag_name: `v0.0.${i}` }));
  stubFetch({
    '/repos/o/r/releases?per_page=100&page=1': full,
    '/repos/o/r/releases?per_page=100&page=2': [{ tag_name: 'v1.0.0' }],
  });
  const all = await fetchReleases('o/r', undefined);
  assert.equal(all.length, 101);
  assert.equal(all.at(-1).tag_name, 'v1.0.0');
});

test('HTTP errors name the path but never the token', async () => {
  globalThis.fetch = async () => new Response('denied', { status: 403 });
  await assert.rejects(fetchBranchHead('o/r', 'main', 'secret-token'), error => {
    assert.match(error.message, /HTTP 403 for \/repos\/o\/r\/git\/ref\/heads\/main/);
    assert.doesNotMatch(error.message, /secret-token/);
    return true;
  });
});
