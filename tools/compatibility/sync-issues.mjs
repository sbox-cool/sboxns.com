import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { github, pages, repository } from './lib/github.mjs';
import { MANAGED, PENDING, planIssues } from './lib/issues.mjs';

import { repositoryIssues } from './lib/issues-api.mjs';
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const repo = repository(option('--repo', process.env.GITHUB_REPOSITORY));
const file = option('--findings');
if (!file) throw new Error('Required --findings FILE');
if (args.includes('--apply') === args.includes('--dry-run')) throw new Error('Select exactly one: --apply or --dry-run');
let token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token && args.includes('--use-gh-auth')) token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
if (args.includes('--apply') && !token) throw new Error('Issue writes require a GitHub token');
const issues = await repositoryIssues(repo, token);
const actions = planIssues(JSON.parse(readFileSync(file, 'utf8')), issues);
if (args.includes('--dry-run')) console.log(JSON.stringify(actions, null, 2));
else {
  if (actions.length) {
    const labels = await pages(`/repos/${repo}/labels`, token);
    for (const [name, color, description] of [[MANAGED, '6a737d', 'Managed compatibility validation tracking'], [PENDING, 'd4c5f9', 'Exact client/server engine validation is still required']]) {
      if (!labels.some(label => label.name.toLowerCase() === name)) await github(`/repos/${repo}/labels`, { token, method: 'POST', body: { name, color, description } });
    }
  }
  for (const action of actions) {
    const issue = await github(`/repos/${repo}/issues${action.action === 'update' ? '/' + action.number : ''}`, { token, method: action.action === 'create' ? 'POST' : 'PATCH', body: action.body });
    console.log(`${action.action}: ${issue.html_url}`);
  }
  console.log(`Compatibility issues: ${actions.length} mutation(s).`);
}
