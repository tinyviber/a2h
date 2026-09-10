import { lstatSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { FileEntry, IgnoredEntry, ScanResult } from '../types';
import { classifyFile } from './classify';
import {
  MAX_DIR_ENTRIES,
  MAX_FILE_BYTES,
  MAX_TOTAL_FILES,
  shouldIgnoreDir,
  shouldIgnoreFile,
} from './ignore';
import { readGitInfo } from './git';
import { deriveIdentity } from '../ir/identity';

const ROOT_NAME_IGNORE = new Set([
  '.git', 'node_modules', '.hg', '.svn',
]);

export interface ScanOptions {
  rootDir: string;
}

export function scanWorkspace(options: ScanOptions): ScanResult {
  const rootDir = resolve(options.rootDir);
  const files: FileEntry[] = [];
  const ignored: IgnoredEntry[] = [];
  const warnings: string[] = [];
  const state = { count: 0 };

  walk(rootDir, '', files, ignored, warnings, state);

  const identity = deriveIdentity(rootDir, files);
  const git = readGitInfo(rootDir);

  return { rootDir, identity, git, files, ignored, warnings };
}

function walk(
  absDir: string,
  relDir: string,
  files: FileEntry[],
  ignored: IgnoredEntry[],
  warnings: string[],
  state: { count: number },
): void {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch (err) {
    warnings.push(`could not read directory ${relDir || '.'}: ${(err as Error).message}`);
    return;
  }

  if (entries.length > MAX_DIR_ENTRIES) {
    warnings.push(`directory ${relDir || '.'} has ${entries.length} entries; only first ${MAX_DIR_ENTRIES} scanned`);
    entries = entries.slice(0, MAX_DIR_ENTRIES);
  }

  for (const dirent of entries) {
    if (state.count >= MAX_TOTAL_FILES) {
      warnings.push(`stopped scanning after ${MAX_TOTAL_FILES} files`);
      return;
    }

    const name = dirent.name;
    const relPath = relDir ? `${relDir}/${name}` : name;

    if (dirent.isDirectory()) {
      if (ROOT_NAME_IGNORE.has(name)) {
        ignored.push({ path: relPath, reason: 'ignored directory' });
        continue;
      }
      const dirCheck = shouldIgnoreDir(name);
      if (dirCheck.ignore) {
        ignored.push({ path: relPath, reason: dirCheck.reason ?? 'ignored directory' });
        continue;
      }
      walk(join(absDir, name), relPath, files, ignored, warnings, state);
      continue;
    }

    // Non-directory (file, symlink, socket, etc.).
    const fileCheck = shouldIgnoreFile(name);
    if (fileCheck.ignore) {
      ignored.push({ path: relPath, reason: fileCheck.reason ?? 'ignored file' });
      continue;
    }

    const absPath = join(absDir, name);
    let st;
    try {
      st = lstatSync(absPath);
    } catch {
      warnings.push(`could not stat ${relPath}`);
      continue;
    }

    const isSymlink = st.isSymbolicLink();
    if (!isSymlink && !st.isFile()) {
      continue; // sockets, fifos, devices — skip silently.
    }

    // Resolve size / mtime (for symlinks, stat the link itself; we do not follow).
    const size = st.size;
    const mtimeMs = st.mtimeMs;

    if (size > MAX_FILE_BYTES) {
      ignored.push({ path: relPath, reason: 'too large' });
      continue;
    }

    const { kind, language, sensitive } = classifyFile(name);
    const ext = extensionLower(name);

    files.push({
      path: relPath,
      absolutePath: absPath,
      kind,
      size,
      mtimeMs,
      ext,
      isSymlink,
      sensitive,
      depth: relDir.split('/').length,
    });
    state.count += 1;
  }
}

function extensionLower(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

// Re-export for convenience in tests.
export { relative as relativePath, sep };
