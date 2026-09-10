import { openSync, readSync, closeSync } from 'node:fs';
import type { ArtifactContent, ContentKind, FileEntry } from '../types';
import { contentKindOf } from '../scanner/classify';
import { renderMarkdown, splitFrontmatter } from '../parsers/markdown';
import { parseDiff } from '../parsers/diff';
import { parseJson } from '../parsers/json';
import { parseLog } from '../parsers/log';
import { parseCode } from '../parsers/code';
import { readFileText } from '../parsers/text';
import { normalizeRel } from '../util/path';

// Content rendering is driven by *what the bytes are*, never by the semantic
// role a producer assigned. A file declared as role "draft" is still markdown;
// a role is a label for humans, not a rendering instruction. This separation is
// what lets producers invent roles freely without breaking the reader.

export interface ContentContext {
  rootDir: string;
  /** Workspace-relative paths (normalized) of all image files. */
  knownImages: Set<string>;
  /** Maps a workspace-relative path to a safe URL the renderer can load. */
  fileUrl: (relPath: string) => string;
}

export function contentKindFor(entry: FileEntry): ContentKind {
  return contentKindOf(entry.kind);
}

export function renderContent(
  entry: FileEntry,
  ctx: ContentContext,
  mode?: 'tail' | 'full',
): ArtifactContent {
  if (entry.sensitive) {
    return { type: 'file', isBinary: false, note: 'Content hidden (sensitive file)' };
  }

  // Symlinks are never followed. A link whose name looks like markdown must not
  // become a read primitive for files outside the workspace.
  if (entry.isSymlink) {
    return { type: 'file', isBinary: false, note: 'Symlink (not followed)' };
  }

  try {
    switch (contentKindFor(entry)) {
      case 'markdown': {
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
  } catch (err) {
    return renderFileFallback(
      entry,
      `Could not render this file as ${contentKindFor(entry)} — showing raw text instead.`,
    );
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

/**
 * Last-resort rendering. An artifact page must never fail because a file was
 * stranger than expected — a malformed patch, a truncated image header, an
 * encoding surprise. Better a plain text view with a note than an error.
 */
function renderFileFallback(entry: FileEntry, reason: string): ArtifactContent {
  const { text, truncated } = readFileText(entry.absolutePath, 64 * 1024);
  if (hasNullByte(Buffer.from(text.slice(0, 8192), 'utf8'))) {
    return { type: 'file', isBinary: true, note: reason };
  }
  return { type: 'file', isBinary: false, text, truncated, note: reason };
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
