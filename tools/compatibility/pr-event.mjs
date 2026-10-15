import { readFileSync, appendFileSync } from 'node:fs';
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
let number = event.pull_request?.number ?? null;
if (event.issue?.pull_request && /^\/compatibility-review\s/.test(event.comment?.body?.trim() ?? '')) number = event.issue.number;
if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') number = event.inputs?.pr;
if (process.env.GITHUB_EVENT_NAME === 'workflow_run') {
  const match = /^(?:Native|Editor) PR #([1-9]\d*) @[a-f0-9]{40}$/.exec(event.workflow_run?.display_title ?? '');
  if (event.workflow_run?.repository?.full_name === process.env.GITHUB_REPOSITORY) number = match?.[1] ?? null;
}
if (number !== null && !/^[1-9]\d*$/.test(String(number))) throw new Error('Invalid PR number in workflow event');
appendFileSync(process.env.GITHUB_OUTPUT, `pr=${number ?? ''}\n`);
