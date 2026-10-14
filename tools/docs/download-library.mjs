// Materialize the published runtime source, not the latest GitHub checkout.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { revisionId } from './lib/revisions.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) throw new Error(`Required ${name}`); return args[i + 1]; };
const revision = revisionId(option('--revision'));
const target = path.resolve(option('--output'));
if (existsSync(target)) throw new Error('Published-source output must be a new directory');
async function bytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
const metadata = JSON.parse((await bytes(`https://public.facepunch.com/sbox/package/get/2/sboxcool.network-storage%23${revision}`)).toString());
if (revisionId(metadata.Version?.Id) !== revision) throw new Error('Pinned package response has a different revision');
const manifestUrl = metadata.Version.ManifestUrl;
if (!manifestUrl?.startsWith(`https://public.facepunch.com/sbox/package/manifest/1/sboxcool.network-storage/${revision}?`)) throw new Error('Unexpected package manifest');
const manifestBytes = await bytes(manifestUrl);
const manifest = JSON.parse(manifestBytes.toString());
const files = manifest.Files.filter(file => file.path.startsWith('Code/') && file.path.endsWith('.cs'));
if (!files.length) throw new Error('Package has no runtime C# source');
const mask = (1n << 64n) - 1n;
const table = Array.from({ length: 256 }, (_, index) => { let c = BigInt(index); for (let bit = 0; bit < 8; bit++) c = c & 1n ? (c >> 1n) ^ 0x9A6C9329AC4BC9B5n : c >> 1n; return c; });
function crc64(data) { let c = mask; for (const byte of data) c = table[Number((c ^ BigInt(byte)) & 255n)] ^ (c >> 8n); return ((c ^ mask) & mask).toString(16); }
if (crc64(Buffer.from('123456789')) !== 'ae8b14860a799888') throw new Error('CRC implementation failed its engine known-answer vector');
const seen = new Set();
for (const file of files) {
  if (file.path.split('/').some(segment => !segment || segment === '..' || segment === '.') || file.path.includes('\\') || seen.has(file.path)) throw new Error('Invalid/duplicate package source path');
  if (new URL(file.url).origin !== 'https://cdn.sbox.game') throw new Error('Unexpected package content host');
  seen.add(file.path);
}
// Verify every downloaded byte before materializing any source.
const downloaded = [];
for (let start = 0; start < files.length; start += 6) {
  downloaded.push(...await Promise.all(files.slice(start, start + 6).map(async file => {
    const data = await bytes(file.url);
    if (data.length !== file.size || crc64(data) !== file.crc) throw new Error(`Published source verification failed: ${file.path}`);
    return { path: file.path, data };
  })));
}
for (const file of downloaded) { const full = path.join(target, file.path); mkdirSync(path.dirname(full), { recursive: true }); writeFileSync(full, file.data); }
const identity = { revision, commit: null, manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), manifestUrl, compilation: 'published-source-recompiled', sourceFiles: downloaded.length };
writeFileSync(path.join(target, 'publication.json'), JSON.stringify(identity, null, 2) + '\n');
console.log(`Verified ${downloaded.length} published runtime sources for revision ${revision}; manifest SHA256 ${identity.manifestSha256}`);
