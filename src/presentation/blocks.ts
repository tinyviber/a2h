import type { Block } from '../types';
import type { WorkspaceReader } from '../security/workspaceRead';
import { renderMarkdown } from '../parsers/markdown';
import { normalizeRel } from '../util/path';

// Blocks authored by a producer arrive as plain JSON. This module turns them
// into render-ready payloads: markdown is compiled server-side with the same
// conservative renderer used for artifacts, and file references are resolved
// through the workspace read capability.
//
// Note what this file does *not* have: a path. It cannot build one, so it
// cannot accidentally read one. A block that names a file asks the reader for
// its text, and the reader decides — sensitive files, symlinks, escapes and
// oversized reads are refused there, once, for every producer-authored
// reference rather than for the ones we remembered to guard.
//
// Unknown block types are passed through untouched — the client registry
// decides what it can draw and shows a readable fallback otherwise. That is
// what keeps this protocol forward-compatible.

export interface BlockContext {
  /**
   * The only route from a producer-authored path to bytes. Absent means no
   * file-backed block can resolve — which is the correct default for a caller
   * that has no scanner index to check against.
   */
  reader?: WorkspaceReader;
  /** Maps an already-validated workspace image path to a servable URL. */
  imageUrl?: (relPath: string) => string | undefined;
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
    // The reader applies the workspace boundary; a refusal and a missing file
    // look the same from here, and both mean "this block has nothing to show".
    const text = ctx.reader?.readText(record.path, MAX_BLOCK_FILE_BYTES);
    // An empty block would render as a blank frame, so treat it as absent.
    if (text === undefined || !text.trim()) return undefined;
    return text;
  }
  return undefined;
}

function resolveBlockImage(
  src: string,
  baseDir: string,
  ctx: BlockContext,
): string | undefined {
  const { reader, imageUrl } = ctx;
  if (!reader || !imageUrl) return undefined;
  const clean = decodeURIComponent(src.split('#')[0]!.split('?')[0]!).trim();
  const rel = baseDir ? normalizeRel(`${baseDir}/${clean}`) : normalizeRel(clean);
  if (!rel) return undefined;
  if (!reader.canReadImage(rel)) return undefined;
  return imageUrl(rel);
}

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}
