// Reads files from a git repository at a given ref without checking it out.
// Repositories are kept as bare clones under .cache/ (gitignored).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const MAX = 256 * 1024 * 1024;

function git(dir, args, encoding = 'utf8') {
  return execFileSync('git', ['-C', dir, ...args], { maxBuffer: MAX, encoding });
}

export function ensureBareClone({ name, url, cacheDir }) {
  mkdirSync(cacheDir, { recursive: true });
  const dir = path.join(cacheDir, `${name}.git`);
  if (!existsSync(dir)) {
    execFileSync('git', ['clone', '--bare', '--quiet', url, dir], { stdio: 'inherit' });
  } else {
    git(dir, ['fetch', '--quiet', '--tags', '--force', 'origin', '+refs/heads/*:refs/heads/*']);
  }
  return dir;
}

function semverKey(tag) {
  return tag.slice(1).split('.').map(Number);
}

// "latest" resolves to the highest vX.Y.Z tag.
export function resolveRef(dir, ref) {
  let target = ref;
  if (ref === 'latest') {
    const tags = git(dir, ['tag', '--list', 'v*'])
      .split('\n')
      .map((t) => t.trim())
      .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
      .sort((a, b) => {
        const x = semverKey(a);
        const y = semverKey(b);
        for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
        return 0;
      });
    if (!tags.length) throw new Error(`no vX.Y.Z tags in ${dir}`);
    target = tags.at(-1);
  }
  const commit = commitOf(dir, target);
  if (!commit) throw new Error(`ref ${target} not found in ${dir}`);
  return { ref: target, commit };
}

// A pinned full SHA can stop being reachable from any branch (for example a squash-merged feature branch). The
// clone only fetches branches and tags, so fetch such a commit explicitly; the pin itself is never changed.
function commitOf(dir, target) {
  const parse = () => {
    try {
      return git(dir, ['rev-parse', '--verify', '--quiet', `${target}^{commit}`]).trim();
    } catch {
      return '';
    }
  };
  const found = parse();
  if (found || !/^[a-f0-9]{40}$/.test(target)) return found;
  git(dir, ['fetch', '--quiet', 'origin', target]);
  return parse();
}

export function readFileAt(dir, commit, file) {
  return git(dir, ['show', `${commit}:${file}`], 'utf8');
}

export function readBinaryAt(dir, commit, file) {
  return git(dir, ['show', `${commit}:${file}`], 'buffer');
}

export function listFilesAt(dir, commit, prefix = '') {
  const out = git(dir, ['ls-tree', '-r', '--name-only', commit, '--', prefix || '.']);
  return out.split('\n').filter(Boolean);
}
