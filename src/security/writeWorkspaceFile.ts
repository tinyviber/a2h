import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeRel } from '../util/path';
import { readHeadNoFollow, statNoFollow } from '../util/safeRead';
import { resolveRealPath } from './boundary';

// ---------------------------------------------------------------------------
// Writing a *replaceable* file into a workspace A2H does not own.
//
// `writeDecisionRecord` already writes one file per attempt, and its O_EXCL
// append is exactly right for that: two attempts must never share a name and an
// existing record must never be clobbered. This helper is the other shape — one
// file at a fixed path that is regenerated in place, where the question is not
// "may I add?" but "may I replace?".
//
// The discipline is the same as the read side, because a workspace is untrusted
// in both directions:
//
//   * the destination must resolve inside the workspace, and its *real* path
//     must still be inside it after creation — an intermediate `.a2h -> /etc`
//     is refused before anything is created, not after;
//   * no component of the path may be a symlink, and the destination itself
//     may not be one either;
//   * the destination must be a regular file or absent — never a directory, a
//     socket, or a device;
//   * overwriting needs a reason. With no `marker`, an existing file is left
//     alone unless `force` is set; with a `marker`, the existing file must
//     carry it. A user's own file is never silently replaced by a generated
//     one;
//   * the bytes land through a temp file in the same directory plus an atomic
//     rename, so a crash mid-write cannot leave a half-written artifact where a
//     complete one used to be. A failed write leaves no temp file behind.
//
// Nothing here trusts its caller. Containment is re-derived from the
// filesystem rather than taken from the lexical join.
// ---------------------------------------------------------------------------

/** How much of an existing file is inspected when looking for the marker. */
const MARKER_HEAD_BYTES = 8 * 1024;

/** A temp name colliding this many times in a row is not a name collision. */
const MAX_TEMP_ATTEMPTS = 8;

let tempCounter = 0;

export type WorkspaceWriteCode = 'exists' | 'refused' | 'failed';

export interface WriteWorkspaceFileOptions {
  /**
   * Replace an existing destination regardless of its contents. The escape
   * hatch for a file the user has deliberately taken ownership of.
   */
  force?: boolean;
  /**
   * A generation marker. When the destination exists it is replaced only if
   * this string appears in the head of the file — the machine-readable way for
   * a generated file to say "regenerate me".
   */
  marker?: string;
}

export interface WriteWorkspaceFileResult {
  written: boolean;
  /** Workspace-relative path, set when the bytes landed. */
  path?: string;
  /** Why nothing was written. Diagnostics only — never thrown. */
  reason?: string;
  code?: WorkspaceWriteCode;
}

export function writeWorkspaceFile(
  rootDir: string,
  relPath: string,
  content: string,
  options: WriteWorkspaceFileOptions = {},
): WriteWorkspaceFileResult {
  const cleaned = relPath.replace(/\\/g, '/');
  if (cleaned.startsWith('/') || /^[A-Za-z]:/.test(cleaned)) {
    return refuse(`${relPath} is not a workspace-relative path`);
  }
  const rel = normalizeRel(cleaned);
  if (rel === null || rel === '') {
    return refuse(`${relPath} does not resolve inside the workspace`);
  }

  const segments = rel.split('/');

  // Every existing ancestor, from the root down: no links, all directories.
  // This runs *before* any create, so mkdir cannot be talked into walking a
  // link out of the tree.
  for (let i = 1; i < segments.length; i++) {
    const prefix = segments.slice(0, i).join('/');
    const stat = statNoFollow(join(rootDir, prefix));
    if (!stat) break; // absent — it will be created below
    if (stat.isSymbolicLink) return refuse(`${prefix} is a symlink`);
    if (!stat.isDirectory) return refuse(`${prefix} is not a directory`);
  }

  const abs = join(rootDir, rel);
  const target = statNoFollow(abs);
  if (target?.isSymbolicLink) return refuse(`${rel} is a symlink`);
  if (target && !target.isFile) return refuse(`${rel} is not a regular file`);

  if (target && !options.force) {
    const marker = options.marker;
    const head = marker ? readHeadNoFollow(abs, MARKER_HEAD_BYTES) ?? '' : '';
    if (!marker || !head.includes(marker)) {
      return { written: false, code: 'exists', reason: `${rel} already exists` };
    }
  }

  const parentRel = segments.length > 1 ? segments.slice(0, -1).join('/') : '';
  if (parentRel) {
    try {
      mkdirSync(join(rootDir, parentRel), { recursive: true });
    } catch (err) {
      return fail(`${rel}: ${(err as Error).message}`);
    }
    // Re-derive containment from the real path rather than trusting the join.
    if (resolveRealPath(rootDir, parentRel) === null) {
      return refuse(`${parentRel} does not resolve inside the workspace`);
    }
  }

  const dirAbs = parentRel ? join(rootDir, parentRel) : rootDir;
  const name = segments[segments.length - 1]!;

  for (let attempt = 0; attempt < MAX_TEMP_ATTEMPTS; attempt++) {
    tempCounter += 1;
    const tmp = join(dirAbs, `.${name}.${process.pid}-${tempCounter}.tmp`);
    try {
      writeFileSync(tmp, content, { flag: 'wx', encoding: 'utf8' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      return fail(`${rel}: ${(err as Error).message}`);
    }
    try {
      renameSync(tmp, abs);
      return { written: true, path: rel };
    } catch (err) {
      rmSync(tmp, { force: true }); // never leave a temp behind
      return fail(`${rel}: ${(err as Error).message}`);
    }
  }

  return fail(`${rel}: could not allocate a temporary file next to it`);
}

function refuse(reason: string): WriteWorkspaceFileResult {
  return { written: false, code: 'refused', reason };
}

function fail(reason: string): WriteWorkspaceFileResult {
  return { written: false, code: 'failed', reason };
}
