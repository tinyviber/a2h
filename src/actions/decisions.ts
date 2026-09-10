import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DecisionRecord } from '../types';
import { resolveRealPath } from '../security/boundary';
import { statNoFollow } from '../util/safeRead';

// ---------------------------------------------------------------------------
// The durable decision log.
//
// The engine used to keep its trail in process memory only, so a refresh — or
// simply restarting the viewer — lost the fact that a human approved
// something. This writes one small record per attempt under
// `.a2h/decisions/<utc>-<actionId>.json` so the trail survives.
//
// Two things this is *not*:
//
//   * it is not an input. A record can never be read back to grant an action
//     authority or to waive a confirmation. The executor policy stays the only
//     source of that, so a workspace cannot approve itself by writing files.
//   * it is not a "make actions real" switch. The mock executor still
//     simulates; persistence is about memory, not about effect.
//
// Writes use the same discipline as the manifest and run reads — a refusal to
// follow a link, a real-path containment check, a byte cap — because this is
// still an untrusted workspace. The final open uses O_EXCL, which refuses a
// symlink at the last component and never clobbers an existing record, so
// "one file per attempt" holds even when two attempts share a millisecond.
// ---------------------------------------------------------------------------

export const DECISIONS_DIR = '.a2h/decisions';

/** Cap for one record. A schema-filtered param set is far smaller than this. */
export const MAX_DECISION_BYTES = 64 * 1024;

/** Bounded collision retries; 50 records in the same millisecond is enough. */
const MAX_COLLISION_SUFFIX = 50;

export interface DecisionWriteResult {
  written: boolean;
  /** Workspace-relative path, when the record landed. */
  path?: string;
  /** Why the record was not written. Diagnostics only — never thrown. */
  reason?: string;
}

/**
 * The canonical file name. `at` is normalized so the name is a stable, sortable
 * timestamp that contains no path separator and no colon (which Windows
 * rejects): `2026-09-10T09-41-00-000Z-approve-draft.json`.
 */
export function decisionFileName(at: string, actionId: string, suffix = 0): string {
  const stamp = utcStamp(at);
  const hashed = slug(actionId);
  return suffix > 0 ? `${stamp}-${hashed}-${suffix + 1}.json` : `${stamp}-${hashed}.json`;
}

export function writeDecisionRecord(rootDir: string, record: DecisionRecord): DecisionWriteResult {
  // `a2h` is stamped here so every producer (the engine today, a tool wrapper
  // later) writes the same protocol version without remembering to.
  const payload: DecisionRecord = { a2h: 1, ...record };
  const data = `${JSON.stringify(payload, null, 2)}\n`;
  // Size is checked before the directory is created, so a refused record
  // leaves no trace at all rather than an empty directory it did not earn.
  if (Buffer.byteLength(data) > MAX_DECISION_BYTES) {
    return { written: false, reason: `record exceeds ${MAX_DECISION_BYTES} bytes` };
  }

  const dir = ensureDir(rootDir);
  if (!dir.ok) return { written: false, reason: dir.reason };

  for (let suffix = 0; suffix <= MAX_COLLISION_SUFFIX; suffix++) {
    const name = decisionFileName(record.at, record.actionId, suffix);
    const rel = `${DECISIONS_DIR}/${name}`;
    const abs = join(rootDir, DECISIONS_DIR, name);

    const existing = statNoFollow(abs);
    if (existing?.isSymbolicLink) return { written: false, reason: `${rel} is a symlink` };
    if (existing && !existing.isFile) return { written: false, reason: `${rel} is not a file` };

    try {
      writeFileSync(abs, data, { flag: 'wx', encoding: 'utf8' });
      return { written: true, path: rel };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') continue; // same timestamp — pick the next name
      return { written: false, reason: (err as Error).message };
    }
  }

  return { written: false, reason: 'too many records share this instant' };
}

/**
 * Makes `.a2h/decisions` exist and proves it is inside the workspace.
 *
 * The order matters. A symlinked `.a2h` is refused *before* `mkdirSync`, so a
 * recursive create cannot be talked into traversing a link out of the tree;
 * only once the link checks pass do we create, and then re-derive containment
 * from the real path rather than trusting the lexical join.
 */
function ensureDir(rootDir: string): { ok: true } | { ok: false; reason: string } {
  const parentRel = '.a2h';
  const parentStat = statNoFollow(join(rootDir, parentRel));
  if (parentStat?.isSymbolicLink) return { ok: false, reason: `${parentRel} is a symlink` };
  if (parentStat && !parentStat.isDirectory) return { ok: false, reason: `${parentRel} is not a directory` };

  const dirStat = statNoFollow(join(rootDir, DECISIONS_DIR));
  if (dirStat?.isSymbolicLink) return { ok: false, reason: `${DECISIONS_DIR} is a symlink` };
  if (dirStat && !dirStat.isDirectory) return { ok: false, reason: `${DECISIONS_DIR} is not a directory` };

  try {
    mkdirSync(join(rootDir, DECISIONS_DIR), { recursive: true });
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  if (resolveRealPath(rootDir, DECISIONS_DIR) === null) {
    return { ok: false, reason: `${DECISIONS_DIR} does not resolve inside the workspace` };
  }
  return { ok: true };
}

const STAMP_PATTERN = /[^0-9A-Za-z]+/g;

function utcStamp(at: string): string {
  const ms = Date.parse(at);
  const iso = Number.isFinite(ms) ? new Date(ms).toISOString() : at;
  return iso.replace(STAMP_PATTERN, '-').replace(/^-+|-+$/g, '') || 'time';
}

/**
 * An action id is producer-controlled, so it is reduced to a filename-safe
 * token rather than interpolated. A `/` or `..` in an id must never reach the
 * filesystem as a separator.
 */
function slug(id: string): string {
  const s = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 60) || 'action';
}
