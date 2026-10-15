export const CONTEXT = 'Network Storage / compatibility';
export const RUNTIME_CONTEXT = 'Network Storage / native compatibility';
export const EDITOR_CONTEXT = 'Network Storage / editor compatibility';
export function classification(body) {
  const text = (body ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const names = new Map([['None', 'none'], ['Additive, off by default', 'additive-default-off'], ['Changed', 'changed'], ['Library code', 'library-code']]);
  const selected = [...text.matchAll(/^\s*- \[[xX]\] \*\*(None|Additive, off by default|Changed|Library code)\*\*/gm)].map(match => names.get(match[1]));
  return selected.length === 1 ? selected[0] : null;
}
export function runtimePath(file) {
  return (/^(Code|Editor)\//.test(file) && !file.split('/').some(segment => ['obj', 'bin', '__pycache__'].includes(segment))) || ['network-storage.sbproj', 'source-authoring.schema.json', '.version'].includes(file) || (file.startsWith('.bin/') && !file.endsWith('.xml'));
}
export function evaluatePullRequest({ head, files, analysis, surface, review, runtimeEvidence, editorEvidence }) {
  if (!/^[a-f0-9]{40}$/.test(head ?? '')) throw new Error('PR head must be a full commit');
  if (!analysis || !Array.isArray(analysis.removed) || !Array.isArray(analysis.added) || !Array.isArray(analysis.nonTriviaChangedFiles) || !Array.isArray(analysis.errors)) throw new Error('Complete contract inspection is required');
  const meaningfulCs = new Set(analysis.nonTriviaChangedFiles);
  const source = files.filter(file => runtimePath(file) && (!file.endsWith('.cs') || meaningfulCs.has(file)));
  const automation = files.some(file => file.startsWith('.github/') || file.startsWith('tools/compatibility/'));
  const runtime = source.some(file => !file.startsWith('Editor/'));
  const editor = source.some(file => file.startsWith('Editor/'));
  const reasons = [];
  if (analysis.errors.length) reasons.push('Contract analysis failed; compatibility is unknown.');
  if (analysis.removed.length) reasons.push(`${analysis.removed.length} existing public contract declaration(s) were removed or changed. Preserve the old contract; a rename/default/signature change is not an additive release.`);
  if (files.some(file => file.startsWith('.bin/') && !file.endsWith('.xml'))) reasons.push('Published/generated package artifacts changed. Source-recompiled tests cannot validate that binary/code-archive change; preserve existing artifacts until actual package-loading evidence is supported.');
  const impacted = source.length > 0 || analysis.added.length > 0 || analysis.removed.length > 0;
  if (impacted || automation) {
    if (!surface) reasons.push('Choose exactly one Client-visible surface classification in the PR template.');
    if (impacted && surface === 'none') reasons.push('Meaningful library/source-authoring changes cannot self-declare no client impact.');
    if (!review || review.head !== head || review.surface !== surface || !review.maintainer) reasons.push(`A maintainer must acknowledge this exact head with /compatibility-review ${head} ${surface ?? '<classification>'}.`);
  }
  if ((runtime || analysis.added.length > 0 && !editor) && (!runtimeEvidence?.verified || runtimeEvidence.head !== head)) reasons.push('Complete trusted native-runtime evidence for this exact head is missing. HTTP-only, another commit, skipped runs and incomplete coverage do not count.');
  if (editor && (!editorEvidence?.verified || editorEvidence.head !== head)) reasons.push('Complete trusted editor evidence for this exact head is missing. A headless runtime test does not validate Sync Tool/editor behavior.');
  return { head, state: reasons.length ? 'failure' : 'success', impact: impacted ? 'potential-client-change' : automation ? 'automation-change' : 'none', surface: surface ?? (impacted ? null : 'none'), sourceFiles: source, removed: analysis.removed, added: analysis.added, reasons };
}
export function prFinding(repo, number, result, prUrl) {
  const active = result.state !== 'success';
  return {
    key: `pr:${repo}:${number}`, category: 'pr-impact', active,
    title: `Compatibility review required for PR #${number}`,
    body: `PR: ${prUrl}\n\nExact head: \`${result.head}\`\n\nStatus: **${active ? 'not validated' : 'compatibility gate satisfied'}**. Static analysis cannot prove behavioral compatibility.\n\n${result.reasons.map(reason => '- ' + reason).join('\n') || 'The current diff and exact-head evidence satisfy the gate. This is not a blanket certification of other builds or environments.'}\n\nExisting public API changes: ${result.removed.length}; additions: ${result.added.length}.\n\n${result.removed.slice(0, 20).map(api => '- Preserve `' + api.symbol.replace(/`/g, '') + '`: `' + api.signature.replace(/`/g, '') + '`').join('\n')}\n\nKeep old methods/request syntax and defaults. Add replacements alongside existing behavior; link a migration/deprecation plan rather than silently changing shipped games. See https://github.com/sbox-cool/sbox-network-storage-server/blob/main/docs/compatibility.md .\n\nAutomation updates only this managed section. Investigation notes outside it are preserved.`,
  };
}
