export const MANAGED = 'compatibility-automation';
export const PENDING = 'pending-sbox-editor-test';
const end = '<!-- /compatibility-automation -->';
const keyPattern = /^[A-Za-z0-9_.:/#-]{1,240}$/;
function marker(key) {
  if (!keyPattern.test(key)) throw new Error('Invalid compatibility issue key');
  return `<!-- compatibility-automation:key=${Buffer.from(key).toString('base64url')} -->`;
}
function managedKey(issue) {
  if (issue.pull_request || !issue.labels?.some(label => (label.name ?? label).toLowerCase() === MANAGED)) return null;
  const matches = [...(issue.body ?? '').matchAll(/<!-- compatibility-automation:key=([A-Za-z0-9_-]+) -->/g)];
  if (!matches.length) return null;
  if (matches.length !== 1) throw new Error(`Ambiguous managed issue #${issue.number}`);
  const key = Buffer.from(matches[0][1], 'base64url').toString();
  if (marker(key) !== matches[0][0]) throw new Error('Invalid managed issue marker');
  return key;
}
function content(finding) {
  if (typeof finding.body !== 'string' || finding.body.includes('<!-- compatibility-automation:') || finding.body.includes(end)) throw new Error('Invalid managed issue body');
  return `${marker(finding.key)}\n${finding.body.trim()}\n${end}`;
}
function preserveNotes(issue, section) {
  const body = issue.body ?? '';
  const start = body.indexOf('<!-- compatibility-automation:key=');
  const finish = body.indexOf(end, start);
  if (start < 0 || finish < 0 || body.indexOf(end, finish + end.length) >= 0) throw new Error(`Malformed managed section in issue #${issue.number}`);
  return body.slice(0, start) + section + body.slice(finish + end.length);
}
export function planIssues(findings, issues) {
  if (!Array.isArray(findings)) throw new Error('Expected compatibility findings array');
  const existing = new Map();
  for (const issue of issues) {
    const key = managedKey(issue);
    if (key === null) continue;
    if (existing.has(key)) throw new Error(`Duplicate managed issue key ${key}; reconcile duplicates manually`);
    existing.set(key, issue);
  }
  const seen = new Set();
  return findings.flatMap(finding => {
    marker(finding.key);
    if (seen.has(finding.key)) throw new Error(`Duplicate finding ${finding.key}`);
    seen.add(finding.key);
    if (typeof finding.active !== 'boolean' || !['untested-build', 'pr-impact'].includes(finding.category) || typeof finding.title !== 'string' || !finding.title.trim() || finding.title.length > 256) throw new Error('Invalid compatibility finding');
    const issue = existing.get(finding.key);
    if (!issue && !finding.active) return [];
    const section = content(finding);
    const labels = issue ? issue.labels.map(label => label.name ?? label) : [MANAGED];
    const nextLabels = labels.filter(label => finding.active || label !== PENDING);
    if (finding.active && !nextLabels.includes(PENDING)) nextLabels.push(PENDING);
    const body = issue ? preserveNotes(issue, section) : section + '\n\n<!-- Human investigation notes can be added outside the managed section. -->';
    const desired = { title: finding.title, body, state: finding.active ? 'open' : 'closed', labels: nextLabels };
    if (!issue) return [{ action: 'create', key: finding.key, body: desired }];
    const update = {};
    if (issue.title !== desired.title) update.title = desired.title;
    if (issue.body !== desired.body) update.body = desired.body;
    if (issue.state !== desired.state) update.state = desired.state;
    if (JSON.stringify(labels) !== JSON.stringify(nextLabels)) update.labels = nextLabels;
    return Object.keys(update).length ? [{ action: 'update', key: finding.key, number: issue.number, body: update }] : [];
  });
}
