import { apiHeaders } from '../../docs/lib/github-public.mjs';

export function repository(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value ?? '')) throw new Error('Expected owner/repository');
  return value;
}
export async function github(route, { token, method = 'GET', body, optional = false } = {}) {
  if (!route.startsWith('/repos/')) throw new Error('Only repository-scoped GitHub API calls are permitted');
  const response = await fetch('https://api.github.com' + route, {
    method, cache: 'no-store', headers: { ...apiHeaders(token), ...(method === 'GET' ? { 'Cache-Control': 'no-cache' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000),
  });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub ${method} returned HTTP ${response.status} for ${route}`);
  return response.status === 204 ? null : response.json();
}
export async function pages(route, token) {
  const rows = [];
  for (let page = 1; page <= 30; page++) {
    const result = await github(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`, { token });
    if (!Array.isArray(result)) throw new Error(`Expected paginated array: ${route}`);
    rows.push(...result);
    if (result.length < 100) return rows;
  }
  throw new Error(`Refusing truncated GitHub pagination: ${route}`);
}

export async function graphql(query, variables, token) {
  if (!token) throw new Error('Fresh GitHub review/issue state requires authentication');
  const response = await fetch('https://api.github.com/graphql', { method: 'POST', cache: 'no-store', headers: { ...apiHeaders(token), 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Fresh GitHub state returned HTTP ${response.status}`);
  const result = await response.json();
  if (result.errors?.length || !result.data) throw new Error('Fresh GitHub state query failed; refusing stale guesses');
  return result.data;
}
