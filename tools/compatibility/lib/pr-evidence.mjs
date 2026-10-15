import { github, graphql } from './github.mjs';
import { RUNTIME_CONTEXT, EDITOR_CONTEXT } from './policy.mjs';
import { verifiedCertificates } from './findings.mjs';

export async function maintainerReview(repo, number, head, token) {
  const [owner, name] = repo.split('/');
  const comments = [];
  let cursor = null;
  for (let page = 0; page < 30; page++) {
    const data = await graphql(`query CompatibilityReviews($owner: String!, $name: String!, $number: Int!, $cursor: String) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { comments(first: 100, after: $cursor) { nodes { body url author { login __typename } } pageInfo { hasNextPage endCursor } } } } }`, { owner, name, number: Number(number), cursor }, token);
    const connection = data.repository?.pullRequest?.comments;
    if (!connection) throw new Error('Fresh PR review state is missing');
    comments.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) break;
    if (page === 29) throw new Error('PR review comments truncated');
    cursor = connection.pageInfo.endCursor;
  }
  for (const comment of comments.reverse()) {
    const match = /^\/compatibility-review ([a-f0-9]{40}) (none|additive-default-off|changed|library-code)\s*$/.exec(comment.body?.trim() ?? '');
    if (!match || match[1] !== head || comment.author?.__typename !== 'User') continue;
    const access = await github(`/repos/${repo}/collaborators/${encodeURIComponent(comment.author.login)}/permission`, { token, optional: true });
    if (['admin', 'maintain', 'write'].includes(access?.permission)) return { head, surface: match[2], maintainer: comment.author.login, url: comment.url };
  }
  return null;
}
export async function nativeEvidence(repo, number, head, branch, context, token) {
  const [owner, name] = repo.split('/');
  const data = await graphql(`query CompatibilityStatus($owner: String!, $name: String!, $head: String!) { repository(owner: $owner, name: $name) { object(expression: $head) { ... on Commit { status { contexts { context state targetUrl creator { login __typename } } } } } } }`, { owner, name, head }, token);
  const contexts = data.repository?.object?.status?.contexts ?? [];
  const status = contexts.find(status => status.context === context);
  if (!status) return canonicalEvidence(head, context);
  if (status.state !== 'SUCCESS' || status.creator?.__typename !== 'Bot' || !['github-actions[bot]', 'github-actions'].includes(status.creator.login)) return { head, verified: false };
  const prefix = `https://github.com/${repo}/actions/runs/`;
  if (!status.targetUrl?.startsWith(prefix) || !/^\d+$/.test(status.targetUrl.slice(prefix.length))) return { head, verified: false };
  const run = await github(`/repos/${repo}/actions/runs/${status.targetUrl.slice(prefix.length)}`, { token });
  return { head, verified: trustedNativeRun(run, { repo, number, head, branch, context }), url: status.targetUrl };
}
export function trustedNativeRun(run, { repo, number, head, branch, context }) {
  const workflow = context === RUNTIME_CONTEXT ? '.github/workflows/native-compatibility.yml' : context === EDITOR_CONTEXT ? '.github/workflows/native-editor-compatibility.yml' : null;
  const title = context === RUNTIME_CONTEXT ? `Native PR #${number} @${head}` : `Editor PR #${number} @${head}`;
  return !!workflow && run.status === 'completed' && run.conclusion === 'success' && run.event === 'workflow_dispatch' && run.head_branch === branch && run.repository?.full_name === repo && run.head_repository?.full_name === repo && run.path?.split('@')[0] === workflow && run.display_title === title;
}

async function canonicalEvidence(head, context) {
  const response = await fetch('https://raw.githubusercontent.com/sbox-cool/sboxns.com/main/docs/validation/index.json', { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return { head, verified: false };
  if (!response.ok) throw new Error(`Canonical native evidence returned HTTP ${response.status}`);
  const mode = context === RUNTIME_CONTEXT ? 'game' : context === EDITOR_CONTEXT ? 'editor' : null;
  const match = verifiedCertificates(await response.json()).find(certificate => certificate.identity.library.commit === head && certificate.identity.clientMode === mode);
  return { head, verified: !!mode && !!match, source: 'reviewed-canonical-record', key: match?.key };
}
