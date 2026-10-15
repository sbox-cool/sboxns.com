import test from 'node:test';
import assert from 'node:assert/strict';
import { planIssues, MANAGED, PENDING } from './lib/issues.mjs';
const finding = () => ({ key: 'pr:fixture/repository:12', title: 'Untested fixture PR', body: 'Exact head needs native validation.', active: true, category: 'pr-impact' });
const created = () => ({ ...planIssues([finding()], [])[0].body, number: 900001, labels: [{ name: MANAGED }, { name: PENDING }, { name: 'human-label' }] });

test('unchanged active findings do not create duplicates or perform writes', () => {
  const issue = created();
  assert.deepEqual(planIssues([finding()], [issue]), []);
});
test('new heads update the managed section while preserving human investigation notes and labels', () => {
  const issue = created();
  issue.body = 'Human preface\n' + issue.body + '\nInvestigated the old client; keep this note.';
  const next = { ...finding(), body: 'A different exact head remains untested.' };
  const [action] = planIssues([next], [issue]);
  assert.equal(action.action, 'update');
  assert.match(action.body.body, /^Human preface/);
  assert.match(action.body.body, /keep this note\.$/);
  assert.equal(action.body.labels, undefined);
});
test('closing an unvalidated issue does not suppress tracking; it reopens without duplicating', () => {
  const issue = { ...created(), state: 'closed' };
  const [action] = planIssues([finding()], [issue]);
  assert.equal(action.action, 'update');
  assert.equal(action.number, issue.number);
  assert.equal(action.body.state, 'open');
});
test('only an explicit resolved finding closes an owned issue; absent and human issues are untouched', () => {
  const issue = created();
  assert.deepEqual(planIssues([], [issue]), []);
  const [action] = planIssues([{ ...finding(), active: false, body: 'Matching evidence recorded.' }], [issue]);
  assert.equal(action.body.state, 'closed');
  assert.deepEqual(action.body.labels, [MANAGED, 'human-label']);
  const human = { ...issue, labels: [] };
  assert.equal(planIssues([finding()], [human])[0].action, 'create');
});
test('duplicate keys and malformed ownership markers fail before any mutation', () => {
  assert.throws(() => planIssues([finding(), finding()], []), /Duplicate finding/);
  assert.throws(() => planIssues([finding()], [created(), { ...created(), number: 900002 }]), /Duplicate managed/);
  assert.throws(() => planIssues([finding()], [{ ...created(), body: created().body.replace('<!-- /compatibility-automation -->', '') }]), /Malformed/);
});
