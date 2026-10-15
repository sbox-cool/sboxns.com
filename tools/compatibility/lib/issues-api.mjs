import { graphql } from './github.mjs';

// Authenticated POST avoids GitHub's 60-second REST list cache after issue creation/label updates.
// Do not use search or a label-filtered connection: their indexing can lag behind writes.
export async function repositoryIssues(repo, token) {
  if (!token) throw new Error('Issue reconciliation requires authenticated fresh reads, including dry runs');
  const [owner, name] = repo.split('/');
  const query = `query CompatibilityIssues($owner: String!, $name: String!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      issues(first: 100, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}, states: [OPEN, CLOSED]) {
        nodes { number title body state labels(first: 100) { nodes { name } pageInfo { hasNextPage } } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }`;
  let cursor = null;
  const issues = [];
  for (let page = 0; page < 30; page++) {
    const data = await graphql(query, { owner, name, cursor }, token);
    const connection = data.repository?.issues;
    if (!connection) throw new Error('Fresh repository issue state is missing');
    for (const issue of connection.nodes) {
      if (issue.labels.pageInfo.hasNextPage) throw new Error(`Issue #${issue.number} has more than 100 labels; refusing to drop human labels`);
      issues.push({ ...issue, state: issue.state.toLowerCase(), labels: issue.labels.nodes });
    }
    if (!connection.pageInfo.hasNextPage) return issues;
    cursor = connection.pageInfo.endCursor;
  }
  throw new Error('Issue query truncated; refusing writes');
}
