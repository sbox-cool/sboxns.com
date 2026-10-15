// Privileged workflow reads PR code as data. It never checks out or executes PR build files/scripts.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { github, pages, repository } from './lib/github.mjs';
import { materializeSource } from './lib/git-source.mjs';
import { classification, evaluatePullRequest, prFinding, CONTEXT, RUNTIME_CONTEXT, EDITOR_CONTEXT } from './lib/policy.mjs';
import { maintainerReview, nativeEvidence } from './lib/pr-evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const repo = repository(option('--repo', process.env.GITHUB_REPOSITORY));
if (repo !== 'sbox-cool/sbox-network-storage') throw new Error('This runtime/editor contract policy targets the library repository; do not silently apply it to server internals.');
const number = option('--pr');
if (!/^[1-9]\d*$/.test(number ?? '')) throw new Error('Required numeric --pr');
const checkout = path.resolve(option('--git', '.'));
const output = path.resolve(option('--output', 'compatibility-results'));
let token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!token && args.includes('--use-gh-auth')) token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
if (args.includes('--apply-status') && !token) throw new Error('Commit statuses require a GitHub token');
const pr = await github(`/repos/${repo}/pulls/${number}`, { token });
if (!/^[a-f0-9]{40}$/.test(pr.head?.sha) || !/^[a-f0-9]{40}$/.test(pr.base?.sha)) throw new Error('PR source identities are missing');
const setStatus = async (state, description) => {
  if (args.includes('--apply-status')) await github(`/repos/${repo}/statuses/${pr.head.sha}`, { token, method: 'POST', body: { context: CONTEXT, state, description: description.slice(0, 140), target_url: pr.html_url } });
};
await setStatus('pending', 'Inspecting public contracts and exact-head compatibility evidence');
mkdirSync(output, { recursive: true });
const work = mkdtempSync(path.join(os.tmpdir(), 'sboxns-pr-contract-'));
let result;
try {
  const git = (...arguments_) => execFileSync('git', ['-C', checkout, ...arguments_], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  git('fetch', '--quiet', '--no-tags', 'origin', `refs/pull/${number}/head`);
  if (git('rev-parse', 'FETCH_HEAD').trim() !== pr.head.sha) throw new Error('PR head changed during inspection; rerun the check');
  git('fetch', '--quiet', '--no-tags', 'origin', pr.base.sha);
  let baseRef = pr.base.sha;
  if (pr.merged) {
    if (!/^[a-f0-9]{40}$/.test(pr.merge_commit_sha ?? '')) throw new Error('Merged PR lacks its historical merge commit');
    git('fetch', '--quiet', '--no-tags', 'origin', pr.merge_commit_sha);
    baseRef = git('rev-parse', `${pr.merge_commit_sha}^1`).trim();
  }
  const base = git('merge-base', baseRef, pr.head.sha).trim();
  materializeSource(checkout, base, path.join(work, 'base'));
  materializeSource(checkout, pr.head.sha, path.join(work, 'head'));
  mkdirSync(path.join(work, 'base'), { recursive: true });
  mkdirSync(path.join(work, 'head'), { recursive: true });
  const inspection = path.join(output, 'inspection.json');
  try {
    execFileSync('dotnet', ['run', '--project', path.join(here, 'ContractInspector'), '--', '--base', path.join(work, 'base'), '--head', path.join(work, 'head'), '--output', inspection], { cwd: here, stdio: 'inherit', timeout: 180_000 });
  } catch (error) { if (error.status !== 2 || !existsSync(inspection)) throw error; }
  const files = (await pages(`/repos/${repo}/pulls/${number}/files`, token)).flatMap(file => [file.filename, ...(file.previous_filename ? [file.previous_filename] : [])]);
  const [repositoryInfo, review] = await Promise.all([github(`/repos/${repo}`, { token }), maintainerReview(repo, number, pr.head.sha, token)]);
  const [runtimeEvidence, editorEvidence] = await Promise.all([
    nativeEvidence(repo, number, pr.head.sha, repositoryInfo.default_branch, RUNTIME_CONTEXT, token),
    nativeEvidence(repo, number, pr.head.sha, repositoryInfo.default_branch, EDITOR_CONTEXT, token),
  ]);
  result = evaluatePullRequest({ head: pr.head.sha, files: [...new Set(files)], analysis: JSON.parse(readFileSync(inspection, 'utf8')), surface: classification(pr.body), review, runtimeEvidence, editorEvidence });
  if (pr.state === 'open' && result.impact !== 'none' && base !== pr.base.sha) { result.state = 'failure'; result.reasons.push('Update this branch to the current base before relying on exact-head compatibility evidence.'); }
  if (pr.state === 'closed' && !pr.merged) { result.state = 'success'; result.reasons = []; result.impact = 'abandoned-not-certified'; }
} catch (error) {
  result = { head: pr.head.sha, state: 'failure', impact: 'unknown', surface: classification(pr.body), removed: [], added: [], reasons: ['Inspection failed closed: ' + error.message] };
} finally { rmSync(work, { recursive: true, force: true }); }
writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
const finding = prFinding(repo, number, result, pr.html_url);
if (result.impact === 'abandoned-not-certified') finding.body = `PR ${pr.html_url} was closed without merging. Tracking is no longer active; no build is certified by this closure.`;
writeFileSync(path.join(output, 'findings.json'), JSON.stringify([finding], null, 2) + '\n');
await setStatus(result.state, result.state === 'success' ? 'Compatibility gate satisfied for this exact head and scope' : result.reasons[0] ?? 'Compatibility evidence is missing');
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.state === 'success' ? 0 : 1;
