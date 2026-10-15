import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFindings } from './lib/findings.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.resolve(here, '../docs');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
if (!option('--output')) throw new Error('Required --output FILE');
if (!process.env.GITHUB_TOKEN && args.includes('--use-gh-auth')) process.env.GITHUB_TOKEN = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
if (!option('--state')) {
  execFileSync(process.execPath, [path.join(docs, 'track-revisions.mjs')], { stdio: 'inherit' });
  execFileSync(process.execPath, [path.join(docs, 'reconcile-releases.mjs')], { stdio: 'inherit' });
}
const state = JSON.parse(readFileSync(option('--state') ?? path.join(docs, 'release-state.json'), 'utf8'));
let certificates;
if (option('--certificates')) certificates = JSON.parse(readFileSync(option('--certificates'), 'utf8'));
else {
  const response = await fetch('https://raw.githubusercontent.com/sbox-cool/sboxns.com/main/docs/validation/index.json', { signal: AbortSignal.timeout(30_000) });
  if (!response.ok && response.status !== 404) throw new Error(`Validation history returned HTTP ${response.status}`);
  certificates = response.status === 404 ? [] : await response.json();
}
const findings = buildFindings(state, certificates);
writeFileSync(option('--output'), JSON.stringify(findings, null, 2) + '\n');
console.log(`Build validation: ${findings.filter(finding => finding.active).length} missing-validation finding(s).`);
