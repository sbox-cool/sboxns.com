// Gate a native-engine report against the exact requested pairing and complete method inventory.
import { readFileSync, writeFileSync } from 'node:fs';
import { certify } from './lib/certification.mjs';

const args = process.argv.slice(2);
function file(option) {
  const index = args.indexOf(option);
  if (index < 0 || !args[index + 1]) throw new Error(`Required: ${option} FILE`);
  return args[index + 1];
}
const json = option => JSON.parse(readFileSync(file(option), 'utf8'));
const certificate = certify(json('--expected'), json('--report'), json('--inventory'));
writeFileSync(file('--output'), JSON.stringify(certificate, null, 2) + '\n');
const validated = certificate.methods.filter(method => method.result === 'pass').length;
console.log(`${certificate.key}: ${certificate.result}; ${validated}/${certificate.methods.length} methods validated for this exact pairing.`);
process.exitCode = certificate.result === 'pass' ? 0 : certificate.result === 'fail' ? 2 : 3;
