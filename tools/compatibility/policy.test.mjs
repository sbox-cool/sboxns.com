import test from 'node:test';
import assert from 'node:assert/strict';
import { classification, evaluatePullRequest } from './lib/policy.mjs';
const head = 'a'.repeat(40);
const analysis = () => ({ removed: [], added: [], nonTriviaChangedFiles: [], errors: [] });
const request = () => ({ head, files: ['README.md'], analysis: analysis(), surface: null, review: null, runtimeEvidence: null, editorEvidence: null });
const validated = () => ({ ...request(), files: ['Code/Client.cs'], analysis: { ...analysis(), nonTriviaChangedFiles: ['Code/Client.cs'] }, surface: 'library-code', review: { head, surface: 'library-code', maintainer: 'fixture-maintainer' }, runtimeEvidence: { head, verified: true } });

test('docs and comments-only source diffs do not require native execution', () => {
  assert.equal(evaluatePullRequest(request()).state, 'success');
  assert.equal(evaluatePullRequest({ ...request(), files: ['Code/Client.cs'] }).state, 'success');
});
test('removing/changing an existing public declaration is blocked even with review and native evidence', () => {
  const input = validated();
  input.analysis.removed = [{ symbol: 'Client.Save', signature: 'public void Save(int amount = 1)' }];
  assert.equal(evaluatePullRequest(input).state, 'failure');
  assert.match(evaluatePullRequest(input).reasons.join(' '), /Preserve the old contract/);
});
test('private/body changes cannot self-declare None or reuse old-head approvals or tests', () => {
  const input = validated();
  assert.equal(evaluatePullRequest(input).state, 'success');
  assert.equal(evaluatePullRequest({ ...input, surface: 'none' }).state, 'failure');
  assert.equal(evaluatePullRequest({ ...input, review: { ...input.review, head: 'b'.repeat(40) } }).state, 'failure');
  assert.equal(evaluatePullRequest({ ...input, runtimeEvidence: { verified: true, head: 'b'.repeat(40) } }).state, 'failure');
  assert.equal(evaluatePullRequest({ ...input, runtimeEvidence: { verified: false, head } }).state, 'failure');
});
test('editor changes cannot use headless runtime evidence as a substitute', () => {
  const input = validated();
  input.files = ['Editor/Sync.cs'];
  input.analysis.nonTriviaChangedFiles = input.files;
  assert.equal(evaluatePullRequest(input).state, 'failure');
  assert.equal(evaluatePullRequest({ ...input, editorEvidence: { head, verified: true } }).state, 'success');
});
test('new public methods need actual validation; malformed analysis and generated binaries fail closed', () => {
  const input = validated();
  input.analysis.added = [{ symbol: 'Client.NewMethod' }];
  assert.equal(evaluatePullRequest({ ...input, runtimeEvidence: null }).state, 'failure');
  assert.equal(evaluatePullRequest({ ...input, files: ['.bin/package.cll'] }).state, 'failure');
  assert.equal(evaluatePullRequest({ ...input, analysis: { ...input.analysis, errors: ['Parse failure'] } }).state, 'failure');
  assert.throws(() => evaluatePullRequest({ ...input, analysis: {} }), /Complete contract/);
});
test('classification requires one visible canonical checkbox; comments and multiple choices do not approve', () => {
  assert.equal(classification('<!-- - [x] **None** -->'), null);
  assert.equal(classification('- [x] **Library code**'), 'library-code');
  assert.equal(classification('- [x] **None**\n- [x] **Changed**'), null);
});
