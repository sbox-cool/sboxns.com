// Runs actual published runtime source inside the native s&box engine against an isolated tagged server.
// This is source-recompiled evidence, NOT certification of the engine's published .cll loading path.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { ensureBareClone, resolveRef } from './lib/git.mjs';
import { materializeSource } from '../compatibility/lib/git-source.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, '../..');
const args = process.argv.slice(2);
function option(name) { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) throw new Error(`Required ${name}`); return args[i + 1]; }
const engine = path.resolve(option('--engine'));
const output = path.resolve(option('--output'));
const revision = args.includes('--revision') ? option('--revision') : null;
const libraryCommit = args.includes('--library-commit') ? option('--library-commit') : null;
const libraryPr = args.includes('--library-pr') ? option('--library-pr') : null;
if (!!revision === !!libraryCommit) throw new Error('Select exactly one --revision or --library-commit');
if (libraryCommit && !/^[a-f0-9]{40}$/.test(libraryCommit)) throw new Error('Library source must be an exact commit');
if (libraryPr && !/^[1-9]\d*$/.test(libraryPr)) throw new Error('Library PR number must be numeric');
const ref = option('--server-ref');
if (!/^v\d+\.\d+\.\d+$/.test(ref)) throw new Error('Select an exact stable server tag');
if (existsSync(output)) throw new Error('Output must be a new directory');
if (!existsSync(path.join(engine, 'bin/managed/Sandbox.Engine.dll'))) throw new Error('A built native sbox engine is required');
if (execFileSync('git', ['status', '--porcelain', '--', 'tools/native-certification', 'tools/docs/run-native.mjs', 'tools/docs/download-library.mjs', 'tools/compatibility/lib/git-source.mjs'], { cwd: site, encoding: 'utf8' }).trim()) throw new Error('Commit the native suite before recording exact-source evidence');
const suiteCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: site, encoding: 'utf8' }).trim();
mkdirSync(output, { recursive: true });
await new Promise((resolve, reject) => {
  const reservation = createServer();
  reservation.once('error', reject);
  reservation.listen(8443, '127.0.0.1', () => reservation.close(resolve));
});
const work = mkdtempSync(path.join(os.tmpdir(), 'sboxns-native-'));
let server;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function treeDigest(root) {
  const records = [];
  function walk(dir) { for (const name of readdirSync(dir).sort()) { const full = path.join(dir, name); if (statSync(full).isDirectory()) walk(full); else records.push([path.relative(root, full).split(path.sep).join('/'), hash(readFileSync(full))]); } }
  walk(root);
  return hash(JSON.stringify(records));
}
function run(command, arguments_, log, options = {}) {
  const fd = openSync(path.join(output, log), 'a');
  try { return execFileSync(command, arguments_, { cwd: site, stdio: ['ignore', fd, fd], timeout: 300_000, ...options }); }
  finally { closeSync(fd); }
}
try {
  let publication;
  if (libraryCommit) {
    const libraryBare = ensureBareClone({ name: 'library', url: 'https://github.com/sbox-cool/sbox-network-storage.git', cacheDir: path.join(here, '.cache') });
    if (libraryPr) {
      run('git', ['-C', libraryBare, 'fetch', '--quiet', 'origin', `refs/pull/${libraryPr}/head`], 'download.log');
      if (execFileSync('git', ['-C', libraryBare, 'rev-parse', 'FETCH_HEAD'], { encoding: 'utf8' }).trim() !== libraryCommit) throw new Error('Candidate PR head changed before the native run');
    }
    const snapshot = materializeSource(libraryBare, libraryCommit, path.join(work, 'library'), ['Code']);
    if (!snapshot.count) throw new Error('Candidate has no runtime source');
    publication = { commit: libraryCommit, revision: null, manifestSha256: snapshot.sha256, compilation: 'github-source' };
    writeFileSync(path.join(work, 'library/publication.json'), JSON.stringify(publication));
  } else {
    run(process.execPath, [path.join(here, 'download-library.mjs'), '--revision', revision, '--output', path.join(work, 'library')], 'download.log');
    publication = JSON.parse(readFileSync(path.join(work, 'library/publication.json'), 'utf8'));
  }
  const bare = ensureBareClone({ name: 'server', url: 'https://github.com/sbox-cool/sbox-network-storage-server.git', cacheDir: path.join(here, '.cache') });
  const source = resolveRef(bare, ref);
  const repo = path.join(work, 'server');
  run('git', ['clone', '--quiet', '--shared', bare, repo], 'build.log');
  run('git', ['checkout', '--quiet', '--detach', source.commit], 'build.log', { cwd: repo });
  run('dotnet', ['build', 'SboxNetworkStorage.sln', '-c', 'Release', '-nologo', '-v', 'q', `-p:Version=${ref.slice(1)}`, `-p:SourceRevisionId=${source.commit}`], 'build.log', { cwd: repo });
  const binaries = path.join(repo, 'src/SboxNetworkStorage.Server/bin/Release/net10.0');
  const artifactSha256 = treeDigest(binaries);
  const dll = path.join(binaries, 'sbox-ns.dll');
  const config = path.join(work, 'config');
  const data = path.join(work, 'data');
  const cli = (...arguments_) => execFileSync('dotnet', [dll, ...arguments_, '--config-dir', config, '--data-dir', data], { encoding: 'utf8', timeout: 30_000 });
  cli('setup', '--non-interactive', '--listen', '127.0.0.1:8443');
  const project = /^Project ID: (.+)$/m.exec(cli('project', 'create', 'Native certification', '--key-mode', 'public', '--require-sbox-auth', 'false'))?.[1]?.trim();
  const key = type => cli('key', 'create', project, '--type', type).split('\n').map(line => line.trim()).find(line => /^sbox_\S+$/.test(line));
  if (!project) throw new Error('Project provisioning did not return an ID');
  const publicKey = key('public');
  const secretKey = key('secret');
  if (!publicKey || !secretKey) throw new Error('Isolated key provisioning failed');
  const fd = openSync(path.join(output, 'server.log'), 'w');
  server = spawn('dotnet', [dll, 'start', '--config-dir', config, '--data-dir', data], { stdio: ['ignore', fd, fd] });
  closeSync(fd);
  server.on('error', error => console.error(error.message));
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error('Isolated server exited before readiness');
    try { ready = (await fetch('http://127.0.0.1:8443/health', { signal: AbortSignal.timeout(500) })).ok; } catch { }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Isolated server did not become ready');
  const info = await (await fetch('http://127.0.0.1:8443/v3/server-info')).json();
  if (info.version !== ref.slice(1) || info.database !== 'sqlite' || info.kind !== 'self-hosted') throw new Error(`Unexpected running server identity: ${JSON.stringify(info)}`);
  const corpus = JSON.parse(readFileSync(path.join(repo, 'tests/parity/corpus/01-management-push.json'), 'utf8'));
  corpus.scenarios = corpus.scenarios.filter(scenario => ['manage-game-values', 'manage-push-all', 'manage-queries'].includes(scenario.name));
  mkdirSync(path.join(work, 'corpus'));
  writeFileSync(path.join(work, 'corpus/bootstrap.json'), JSON.stringify(corpus));
  run('dotnet', [path.join(repo, 'tools/SboxNetworkStorage.Parity/bin/Release/net10.0/sbox-ns-parity.dll'), 'check', '--target', 'http://127.0.0.1:8443', '--project-id', project, '--public-key', publicKey, '--secret-key', secretKey, '--corpus', path.join(work, 'corpus')], 'bootstrap.log');
  const nativeDir = { darwin: 'osxarm64', win32: 'win64', linux: os.arch() === 'arm64' ? 'linuxsteamrtarm64' : 'linuxsteamrt64' }[os.platform()];
  const engineManifest = JSON.parse(readFileSync(path.join(engine, 'bin/.sbox-artifacts.json'), 'utf8'));
  const identity = {
    server: { version: info.version, kind: info.kind, commit: source.commit, artifactSha256 },
    library: { commit: publication.commit, revision: publication.revision, manifestSha256: publication.manifestSha256, compilation: publication.compilation },
    engineBuild: `git:${engineManifest.commit};managed:${treeDigest(path.join(engine, 'bin/managed'))};native:${treeDigest(path.join(engine, 'bin', nativeDir))}`,
    database: 'sqlite', clientMode: 'game', securityMode: 'no-player-auth', suite: { commit: suiteCommit },
  };
  writeFileSync(path.join(output, 'requested.json'), JSON.stringify(identity));
  run('dotnet', ['test', path.join(site, 'tools/native-certification/NativeCertification.csproj'), '-nologo', `-p:SboxGame=${engine}`, `-p:NsLibrary=${path.join(work, 'library')}`, '--logger', `trx;LogFileName=${path.join(output, 'native.trx')}`], 'native.log', {
    env: { ...process.env, FACEPUNCH_ENGINE: engine, NS_E2E_PROJECT: project, NS_E2E_KEY: publicKey, NS_E2E_BASEURL: 'http://127.0.0.1:8443', NS_CERT_IDENTITY: path.join(output, 'requested.json'), NS_CERT_OUTPUT: output },
  });
  console.log(`Native ${publication.compilation} run completed. Reports: ${output}. Add the durable run/artifact evidence URL before invoking certify.mjs; do not treat partial method coverage as a full certification.`);
} finally {
  if (server?.pid && server.exitCode === null) {
    await new Promise(resolve => { const timer = setTimeout(() => { server.kill('SIGKILL'); }, 5000); server.once('exit', () => { clearTimeout(timer); resolve(); }); server.kill('SIGTERM'); });
  }
  rmSync(work, { recursive: true, force: true });
}
