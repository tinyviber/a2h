import { createWorkspaceReader } from '../security/workspaceRead';
import type { LoadedSemantics } from '../semantics/types';
import type { Block, ScanResult } from '../types';
import { normalizeRel } from '../util/path';

// ---------------------------------------------------------------------------
// Every protocol field that claims "a human-readable workspace file is here".
//
// `a2h validate` used to check `items[].path` and nothing else, which meant a
// task could point `artifacts` at a file that never existed, or a markdown
// block could point at one, and validate would still say the workspace was
// presentable. The viewer would then show the human a promise it could not
// keep. This module is the one list of what counts as a path claim.
//
// What is deliberately *not* a path claim: `action.target`, `relation.target`,
// list `href`, action ids, and every other free string. Those are labels and
// links, not file references — treating them as paths would invent a contract
// the protocol does not have, and would break workspaces that legitimately use
// `relation.target` for a node id or `action.target` for a directory prefix.
//
// The claim set is read from `src/semantics/types.ts`, not guessed: only
// `MarkdownBlock` carries a `path` field, and it is the only block type that
// references a workspace file. A new block type that does so has to be added
// here on purpose.
// ---------------------------------------------------------------------------

export type PathClaimKind = 'item' | 'task artifact' | 'run artifact' | 'markdown block';

export interface PathClaim {
  kind: PathClaimKind;
  /** How the claim reads in an error line, e.g. `task "review" artifact`. */
  owner: string;
  /** The path exactly as the producer wrote it. */
  path: string;
}

/** Collects the path claims a producer made, in a stable order. */
export function collectPathClaims(loaded: LoadedSemantics): PathClaim[] {
  const claims: PathClaim[] = [];

  for (const item of loaded.itemSpecs) {
    claims.push({ kind: 'item', owner: 'item', path: item.path });
    claims.push(...blockClaims(item.blocks, `item "${item.path}"`));
  }

  for (const task of loaded.taskSpecs) {
    for (const artifact of task.artifacts ?? []) {
      claims.push({ kind: 'task artifact', owner: `task "${task.id}" artifact`, path: artifact });
    }
    claims.push(...blockClaims(task.blocks, `task "${task.id}"`));
  }

  for (const run of loaded.runSpecs) {
    for (const artifact of run.artifacts ?? []) {
      claims.push({ kind: 'run artifact', owner: `run "${run.id}" artifact`, path: artifact });
    }
    claims.push(...blockClaims(run.blocks, `run "${run.id}"`));
  }

  claims.push(...blockClaims(loaded.panels, 'panel'));

  return claims;
}

/**
 * Verifies the claims against the scanned workspace, using the same reader the
 * viewer uses. Returns one error line per claim that a human could not be shown.
 *
 * The reader is the point: it answers with the scanner's allowlist, the
 * sensitive classification, the symlink refusal, and real-path containment, so
 * "validate passes" means "the viewer can read this" rather than "a string
 * appeared somewhere".
 */
export function checkPathClaims(
  rootDir: string,
  scan: ScanResult,
  loaded: LoadedSemantics,
): string[] {
  const reader = createWorkspaceReader({ rootDir, files: scan.files });
  const errors: string[] = [];

  for (const claim of collectPathClaims(loaded)) {
    const rel = normalizeClaim(claim.path);
    if (rel === null) {
      errors.push(`${claim.owner} "${claim.path}" points outside the workspace`);
      continue;
    }
    if (!reader.has(rel)) {
      errors.push(`${claim.owner} "${claim.path}" points at a path that is not in the scanned workspace`);
      continue;
    }
    if (!reader.canReadText(rel)) {
      errors.push(
        `${claim.owner} "${claim.path}" is not a file A2H will render ` +
          '(a symlink, a sensitive file, or outside the workspace)',
      );
    }
  }

  return errors;
}

/**
 * Normalizes a claimed path the way the scanner stores paths: forward slashes,
 * no leading `./`, `.`/`..` resolved. Returns null for anything that does not
 * name a place inside the workspace.
 *
 * The absolute-path and drive-letter checks run on the raw string, because
 * normalization would otherwise quietly turn `/etc/passwd` into the relative
 * `etc/passwd` and report it as merely missing.
 */
function normalizeClaim(raw: string): string | null {
  const cleaned = raw.replace(/\\/g, '/');
  if (cleaned.startsWith('/') || /^[A-Za-z]:/.test(cleaned)) return null;
  const rel = normalizeRel(cleaned);
  return rel === null || rel === '' ? null : rel;
}

/** Markdown blocks that name a workspace file — the only block form that does. */
function blockClaims(blocks: Block[] | undefined, owner: string): PathClaim[] {
  if (!blocks) return [];
  const claims: PathClaim[] = [];
  blocks.forEach((block, index) => {
    const path = markdownBlockPath(block);
    if (path === undefined) return;
    claims.push({
      kind: 'markdown block',
      owner: `${owner} markdown block #${index + 1}`,
      path,
    });
  });
  return claims;
}

function markdownBlockPath(block: Block): string | undefined {
  const candidate = block as { type?: unknown; path?: unknown };
  if (candidate.type !== 'markdown') return undefined;
  return typeof candidate.path === 'string' && candidate.path.trim() !== ''
    ? candidate.path
    : undefined;
}
