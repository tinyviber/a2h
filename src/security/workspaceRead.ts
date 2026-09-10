import type { FileEntry } from '../types';
import { classifyFile, contentKindOf } from '../scanner/classify';
import { normalizeRel } from '../util/path';
import { readFileNoFollow } from '../util/safeRead';
import { resolveRealPath } from './boundary';

// ---------------------------------------------------------------------------
// The workspace read capability.
//
// Producer-authored content can name any path it likes: a markdown block, an
// image reference, a relation target, a future protocol extension. This module
// is the one place such a name is turned into bytes.
//
// The point is not that these five checks are individually clever — it is that
// they live here rather than at each call site. A caller cannot forget them,
// and a new protocol feature gets them for free by asking for a reader instead
// of for a path.
//
//   1. the path must name a file the scanner indexed (the allowlist — a path
//      the scanner skipped was skipped for a reason);
//   2. it must not be sensitive (a secret is a secret regardless of who is
//      asking nicely);
//   3. it must not be a symlink (the scanner already refuses to descend into
//      one, and a link whose name looks like markdown must never become a read
//      primitive);
//   4. its *real* path must still be inside the workspace — this is the check
//      that catches an intermediate directory that is a link out of the tree,
//      which lexical normalization cannot see;
//   5. the read is bounded, with a ceiling the caller cannot raise.
//
// Checks 1–3 are properties of the scanner's entry. 4 and 5 are re-derived
// here, per call, because a capability that trusts its caller's earlier
// checking is not a boundary.
// ---------------------------------------------------------------------------

/** Default cap for one producer-authored text read. */
export const DEFAULT_MAX_TEXT_BYTES = 512 * 1024;

/** Hard ceiling. A caller may ask for less, never for more. */
export const MAX_TEXT_BYTES_CEILING = 4 * 1024 * 1024;

export interface WorkspaceReaderOptions {
  rootDir: string;
  /** The scanner's index. Its contents are the allowlist. */
  files: readonly FileEntry[];
}

export interface WorkspaceReader {
  /** True when `rel` names a file the scanner indexed. */
  has(rel: string): boolean;
  /** True when `rel` is a scanned file that may be read as text. */
  canReadText(rel: string): boolean;
  /**
   * Reads a workspace-relative text file. Returns undefined unless the path
   * passed every check above. An empty file reads as an empty string.
   */
  readText(rel: string, maxBytes?: number): string | undefined;
  /** True when `rel` is a scanned image that may be served to the browser. */
  canReadImage(rel: string): boolean;
}

export function createWorkspaceReader(options: WorkspaceReaderOptions): WorkspaceReader {  const { rootDir } = options;
  const byPath = new Map<string, FileEntry>();
  for (const file of options.files) byPath.set(file.path, file);

  function entryFor(rel: string): FileEntry | undefined {
    const normalized = normalizeRel(rel);
    if (normalized === null || normalized === '') return undefined;
    return byPath.get(normalized);
  }

  /**
   * The shared gate. `resolveRealPath` runs on every call rather than once at
   * scan time: a directory in the tree can be replaced with a link after the
   * scan, and the containment answer has to be current when the bytes move.
   *
   * Sensitivity is re-derived from the name rather than read off the index's
   * flag alone. The flag is the scanner's answer, and the scanner is good at
   * this — but "the index says it is fine" is precisely the kind of claim a
   * boundary should not have to take on faith.
   */
  function allows(entry: FileEntry | undefined, want: 'text' | 'image'): boolean {
    if (!entry) return false;
    if (entry.sensitive) return false;
    if (classifyFile(basename(entry.path)).sensitive) return false;
    if (entry.isSymlink) return false;
    if (want === 'image' && contentKindOf(entry.kind) !== 'image') return false;
    return resolveRealPath(rootDir, entry.path) !== null;
  }

  return {
    has(rel) {
      return entryFor(rel) !== undefined;
    },

    canReadText(rel) {
      return allows(entryFor(rel), 'text');
    },

    readText(rel, maxBytes = DEFAULT_MAX_TEXT_BYTES) {
      const entry = entryFor(rel);
      if (!allows(entry, 'text')) return undefined;

      const abs = resolveRealPath(rootDir, entry!.path);
      if (abs === null) return undefined;

      const cap = Math.min(Math.max(0, maxBytes), MAX_TEXT_BYTES_CEILING);
      const read = readFileNoFollow(abs, cap);
      return read?.text;
    },

    canReadImage(rel) {
      return allows(entryFor(rel), 'image');
    },
  };
}

/** The last segment of a workspace-relative path. */
function basename(rel: string): string {
  const slash = rel.lastIndexOf('/');
  return slash === -1 ? rel : rel.slice(slash + 1);
}
