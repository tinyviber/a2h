import { openSync, readSync, closeSync } from 'node:fs';
import type { ArtifactContent, ArtifactKind, FileEntry } from '../types';
import { renderMarkdown, splitFrontmatter } from '../parsers/markdown';
import { parseDiff } from '../parsers/diff';
import { parseJson } from '../parsers/json';
import { parseLog } from '../parsers/log';
import { parseCode } from '../parsers/code';
import { readFileText } from '../parsers/text';
import { normalizeRel } from '../util/path';

export interface ContentContext {
  rootDir: string;
  /** Workspace-relative paths (normalized) of all image files. */
  knownImages: Set<string>;
  /** Maps a workspace-relative path to a safe URL the renderer can load. */
  fileUrl: (relPath: string) => string;
}

export function renderContent(
  entry: FileEntry,
  kind: ArtifactKind,
  ctx: ContentContext,
  mode?: 'tail' | 'full',
): ArtifactContent {
  if (entry.sensitive) {
    return { type: 'file', isBinary: false, note: 'Content hidden (sensitive file)' };
  }

  switch (kind) {
    case 'readme':
    case 'markdown':
    case 'report': {
      const { text } = readFileText(entry.absolutePath, 2 * 1024 * 1024);
      const { frontmatter, body } = splitFrontmatter(text);
      const baseDir = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
      const html = renderMarkdown(body, (src) => resolveImage(src, baseDir, ctx));
      return { type: 'markdown', html, frontmatter };
    }
    case 'diff': {
      const { text } = readFileText(entry.absolutePath, 2 * 1024 * 1024);
      return parseDiff(text);
    }
    case 'json':
      return parseJson(entry.absolutePath);
    case 'log':
      return parseLog(entry.absolutePath, mode === 'full');
    case 'code':
      return parseCode(entry.absolutePath, entry.ext);
    case 'image':
      return { type: 'image', url: ctx.fileUrl(entry.path) };
    case 'file':
    default:
      return renderFile(entry);
  }
}

function resolveImage(
  src: string,
  baseDir: string,
  ctx: ContentContext,
): string | undefined {
  // Ignore query/hash and URL-encoded spaces, then resolve relative to the
  // markdown file's directory.
  const clean = decodeURIComponent(src.split('#')[0]!.split('?')[0]!).trim();
  const rel = baseDir ? normalizeRel(`${baseDir}/${clean}`) : normalizeRel(clean);
  if (!rel) return undefined;
  if (!ctx.knownImages.has(rel)) return undefined;
  return ctx.fileUrl(rel);
}

function renderFile(entry: FileEntry): ArtifactContent {
  if (entry.isSymlink) {
    return { type: 'file', isBinary: false, note: 'Symlink (not followed)' };
  }
  if (entry.kind === 'binary') {
    return { type: 'file', isBinary: true };
  }
  // Unknown extension: inspect the first chunk for a binary signature.
  const head = readBytes(entry.absolutePath, 8192);
  if (hasNullByte(head)) {
    return { type: 'file', isBinary: true };
  }
  const { text, truncated } = readFileText(entry.absolutePath, 64 * 1024);
  return { type: 'file', isBinary: false, text, truncated };
}

function readBytes(path: string, max: number): Buffer {
  const buf = Buffer.alloc(max);
  let fd;
  try {
    fd = openSync(path, 'r');
    const n = readSync(fd, buf, 0, max, 0);
    return buf.slice(0, n);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function hasNullByte(buf: Buffer): boolean {
  return buf.includes(0);
}
