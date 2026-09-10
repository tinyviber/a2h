import type { Block } from '../types';
import { renderMarkdown } from '../parsers/markdown';
import { readFileText } from '../parsers/text';
import { normalizeRel } from '../util/path';

// Blocks authored by a producer arrive as plain JSON. This module turns them
// into render-ready payloads: markdown is compiled server-side with the same
// conservative renderer used for artifacts, and file references are resolved
// against the workspace.
//
// Unknown block types are passed through untouched — the client registry
// decides what it can draw and shows a readable fallback otherwise. That is
// what keeps this protocol forward-compatible.

export interface BlockContext {
  rootDir: string;
  /** Maps a workspace-relative image path to a servable URL, if it exists. */
  resolveImage?: (relPath: string) => string | undefined;
}

const MAX_BLOCK_FILE_BYTES = 512 * 1024;

export function resolveBlocks(
  blocks: Block[] | undefined,
  ctx: BlockContext,
): Block[] | undefined {
  if (!blocks || blocks.length === 0) return undefined;
  const out: Block[] = [];
  for (const block of blocks) {
    const resolved = resolveBlock(block, ctx);
    if (resolved) out.push(resolved);
  }
  return out.length ? out : undefined;
}

function resolveBlock(block: Block, ctx: BlockContext): Block | undefined {
  if (!block || typeof block.type !== 'string') return undefined;
  const record = block as Record<string, unknown>;

  if (block.type === 'markdown') {
    const source = readBlockText(record, ctx);
    if (source === undefined) return undefined;
    const baseDir = typeof record.path === 'string' ? dirOf(record.path) : '';
    return {
      ...record,
      type: 'markdown',
      html: renderMarkdown(source, (src) => resolveBlockImage(src, baseDir, ctx)),
    };
  }

  return block;
}

function readBlockText(record: Record<string, unknown>, ctx: BlockContext): string | undefined {
  if (typeof record.text === 'string') {
    return record.text.trim() ? record.text : undefined;
  }
  if (typeof record.path === 'string') {
    const rel = normalizeRel(record.path);
    if (!rel) return undefined;
    const { text, totalBytes } = readFileText(`${ctx.rootDir}/${rel}`, MAX_BLOCK_FILE_BYTES);
    // A missing file, an unreadable one, or a symlink all come back empty. An
    // empty block would render as a blank frame, so treat it as absent.
    if (totalBytes === 0 || !text.trim()) return undefined;
    return text;
  }
  return undefined;
}

function resolveBlockImage(
  src: string,
  baseDir: string,
  ctx: BlockContext,
): string | undefined {
  if (!ctx.resolveImage) return undefined;
  const clean = decodeURIComponent(src.split('#')[0]!.split('?')[0]!).trim();
  const rel = baseDir ? normalizeRel(`${baseDir}/${clean}`) : normalizeRel(clean);
  if (!rel) return undefined;
  return ctx.resolveImage(rel);
}

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}
