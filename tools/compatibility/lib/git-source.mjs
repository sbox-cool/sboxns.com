import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export function materializeSource(repo, commit, output, roots = ['Code', 'Editor']) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Source snapshot requires an exact commit');
  const files = execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', '-z', commit, '--', ...roots], { maxBuffer: 32 * 1024 * 1024 }).toString().split('\0').filter(Boolean);
  const records = [];
  for (const file of files) {
    if (!file.endsWith('.cs') || file.split('/').some(part => ['obj', 'bin'].includes(part))) continue;
    if (file.includes('\\') || file.split('/').some(part => part === '..' || part === '.')) throw new Error('Invalid source path');
    const bytes = execFileSync('git', ['-C', repo, 'show', `${commit}:${file}`], { maxBuffer: 16 * 1024 * 1024 });
    const destination = path.join(output, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
    records.push([file, createHash('sha256').update(bytes).digest('hex')]);
  }
  return { count: records.length, sha256: createHash('sha256').update(JSON.stringify(records)).digest('hex') };
}
