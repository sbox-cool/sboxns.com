import test from 'node:test';
import assert from 'node:assert/strict';
import { trustedNativeRun } from './lib/pr-evidence.mjs';
import { RUNTIME_CONTEXT, EDITOR_CONTEXT } from './lib/policy.mjs';
const repo = 'sbox-cool/sbox-network-storage', head = 'a'.repeat(40);
const expected = { repo, head, number: 12, branch: 'main', context: RUNTIME_CONTEXT };
const run = () => ({ status: 'completed', conclusion: 'success', event: 'workflow_dispatch', head_branch: 'main', repository: { full_name: repo }, head_repository: { full_name: repo }, path: '.github/workflows/native-compatibility.yml', display_title: `Native PR #12 @${head}` });
test('only a completed trusted-default-branch workflow for this exact PR/head counts', () => {
  assert.equal(trustedNativeRun(run(), expected), true);
  for (const overrides of [
    { conclusion: 'failure' }, { conclusion: 'skipped' }, { status: 'in_progress' },
    { event: 'pull_request' }, { head_branch: 'untrusted-feature' },
    { repository: { full_name: 'external/fork' } }, { head_repository: { full_name: 'external/fork' } },
    { path: '.github/workflows/ordinary-http-tests.yml' },
    { display_title: `Native PR #12 @${'b'.repeat(40)}` }, { display_title: `Native PR #13 @${head}` },
  ]) assert.equal(trustedNativeRun({ ...run(), ...overrides }, expected), false);
});
test('runtime workflow evidence cannot stand in for an editor run', () => {
  assert.equal(trustedNativeRun(run(), { ...expected, context: EDITOR_CONTEXT }), false);
  assert.equal(trustedNativeRun({ ...run(), path: '.github/workflows/native-editor-compatibility.yml', display_title: `Editor PR #12 @${head}` }, { ...expected, context: EDITOR_CONTEXT }), true);
});
