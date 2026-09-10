// Ignore rules for directories and files that are clearly not worth scanning.
// Kept as a single table so future configuration has one obvious seam.

export interface IgnoreRule {
  reason: string;
}

const IGNORED_DIRS = new Set([
  '.git', '.hg', '.svn',
  'node_modules', 'bower_components',
  '.cache', '.parcel-cache', '.next', '.nuxt', '.turbo', '.svelte-kit',
  'dist', 'build', 'out', 'target', '.output',
  'coverage', '.nyc_output',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox',
  '.venv', 'venv', '.virtualenv',
  '.yarn', '.pnpm-store',
  'vendor',
  '.idea', '.vscode', '.fleet',
]);

const IGNORED_FILE_NAMES = new Set([
  '.DS_Store', 'Thumbs.db', 'desktop.ini',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  'Cargo.lock', 'Pipfile.lock', 'poetry.lock', 'go.sum',
]);

export function shouldIgnoreDir(name: string): { ignore: boolean; reason?: string } {
  if (IGNORED_DIRS.has(name)) {
    return { ignore: true, reason: 'ignored directory' };
  }
  return { ignore: false };
}

export function shouldIgnoreFile(name: string): { ignore: boolean; reason?: string } {
  if (IGNORED_FILE_NAMES.has(name)) {
    return { ignore: true, reason: 'lockfile / os metadata' };
  }
  if (name.endsWith('~') || name.endsWith('.swp') || name.endsWith('.swo')) {
    return { ignore: true, reason: 'editor temp file' };
  }
  return { ignore: false };
}

// ---------------------------------------------------------------------------
// Size / count guards
// ---------------------------------------------------------------------------

/** Files larger than this are ignored entirely. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Text files larger than this are truncated when previewed. */
export const MAX_TEXT_BYTES = 512 * 1024;

/** Safety cap on the total number of scanned files. */
export const MAX_TOTAL_FILES = 20000;

/** Safety cap on entries within a single directory. */
export const MAX_DIR_ENTRIES = 2000;

/** Maximum number of lines we will tail from a log for the preview. */
export const LOG_TAIL_LINES = 200;
