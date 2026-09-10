import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GitInfo } from '../types';

// Git metadata is read-only and best-effort. If git is unavailable or the
// directory is not a repository, we degrade to `{ isRepo: false }` silently.

function tryGit(root: string, args: string[]): string | undefined {
  try {
    const out = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
    return out.trim();
  } catch {
    return undefined;
  }
}

export function readGitInfo(root: string): GitInfo {
  if (!existsSync(join(root, '.git'))) {
    return { isRepo: false };
  }

  const branch = tryGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const hash = tryGit(root, ['rev-parse', '--short', 'HEAD']);
  const subject = tryGit(root, ['log', '-1', '--pretty=%s']);
  const date = tryGit(root, ['log', '-1', '--pretty=%ct']);

  const info: GitInfo = { isRepo: true };
  if (branch && branch !== 'HEAD') info.branch = branch;
  if (hash) {
    info.lastCommit = {
      hash,
      dateMs: date ? Number(date) * 1000 : 0,
      subject: subject ?? '',
    };
  }
  return info;
}
