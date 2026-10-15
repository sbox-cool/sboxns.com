import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { certify } from '../docs/lib/certification.mjs';
const root = process.argv[2];
const evidence = process.env.NATIVE_EVIDENCE_URL;
if (!root || !evidence?.startsWith('https://github.com/sbox-cool/sbox-network-storage/actions/runs/')) throw new Error('Trusted native report root and run evidence URL are required');
let complete = true;
let baselineIdentity;
for (const stage of ['baseline', 'candidate']) {
  const directory = path.join(root, stage);
  const json = file => JSON.parse(readFileSync(path.join(directory, file), 'utf8'));
  const report = json('native-report.json');
  report.evidence = [evidence];
  if (stage === 'candidate' && report.identity.library.commit !== process.env.NATIVE_HEAD) throw new Error('Candidate report is not for the requested PR head');
  if (stage === 'baseline' && report.identity.library.revision !== process.env.NATIVE_BASELINE) throw new Error('Baseline report is not for the requested published revision');
  if (stage === 'baseline') baselineIdentity = report.identity;
  else if (report.identity.server.commit !== baselineIdentity.server.commit || report.identity.server.version !== baselineIdentity.server.version || report.identity.engineBuild !== baselineIdentity.engineBuild || report.identity.database !== baselineIdentity.database || report.identity.securityMode !== baselineIdentity.securityMode || report.identity.suite.commit !== baselineIdentity.suite.commit) throw new Error('Baseline and candidate did not exercise the same server source, engine, provider, security mode and test suite');
  const certificate = certify(json('expected.json'), report, json('inventory.json'));
  writeFileSync(path.join(directory, 'native-report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(path.join(directory, 'certification.json'), JSON.stringify(certificate, null, 2) + '\n');
  console.log(`${stage}: ${certificate.result}; ${certificate.methods.filter(method => method.result === 'pass').length}/${certificate.methods.length} methods validated.`);
  if (certificate.result !== 'pass') complete = false;
}
process.exitCode = complete ? 0 : 3;
