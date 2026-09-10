import { openNoFollow, readHeadNoFollow, readBytesNoFollow } from '../util/safeRead';
import type { ArtifactMeta } from '../types';

// Lightweight enrichment: reads only what is needed to produce a useful
// title / summary / dimensions for a file, without parsing everything.
//
// All reads are symlink-safe (see util/safeRead). A link that points outside
// the workspace must not be able to contribute a title, a summary, or a line
// count to the UI.

export function readHead(path: string, maxBytes: number): string {
  return readHeadNoFollow(path, maxBytes) ?? '';
}

export interface TitleSummary {
  title?: string;
  summary?: string;
}

export function extractMarkdownHeading(text: string): TitleSummary {
  const lines = text.split(/\r?\n/);
  let title: string | undefined;
  let summary: string | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (!title) {
      const h1 = line.match(/^#\s+(.+)$/);
      if (h1) {
        title = clean(h1[1]!);
        continue;
      }
      if (line === '---' || line === '+++' || line.startsWith('<!--') || line === '') continue;
      // No title found and we hit real prose — don't keep scanning forever.
      if (line && !line.startsWith('```')) continue;
    } else {
      if (line === '') continue;
      if (line.startsWith('#') || line.startsWith('```') || line.startsWith('>') || line.startsWith('|')) continue;
      if (/^[-*]\s|^\d+\.\s/.test(line)) break;
      summary = clean(line);
      break;
    }
  }
  if (summary && summary.length > 160) summary = summary.slice(0, 157) + '…';
  return { title, summary };
}

function clean(s: string): string {
  return s.replace(/[`*_~]/g, '').replace(/\s+/g, ' ').trim();
}

export interface DiffStats {
  files: number;
  added: number;
  removed: number;
}

export function diffStats(path: string): DiffStats {
  const text = readHead(path, 256 * 1024);
  const lines = text.split(/\r?\n/);
  const fileSet = new Set<string>();
  let added = 0;
  let removed = 0;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/diff --git a\/(.+?) b\/(.+)$/);
      if (m) fileSet.add(m[2] ?? m[1]!);
      inHunk = true;
      continue;
    }
    if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
    if (line.startsWith('Index: ')) {
      fileSet.add(line.slice('Index: '.length).trim());
      continue;
    }
    if (line.startsWith('@@')) { inHunk = true; continue; }
    if (inHunk) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++;
      else if (line.startsWith('-') && !line.startsWith('---')) removed++;
    }
  }

  return { files: fileSet.size, added, removed };
}

export function countLines(path: string, maxBytes: number): number | undefined {
  const slice = readBytesNoFollow(path, maxBytes);
  if (!slice) return undefined;
  let count = 0;
  for (const b of slice) if (b === 0x0a) count++;
  return count;
}

export interface Dims {
  width: number;
  height: number;
}

export function imageDimensions(path: string, ext: string): Dims | undefined {
  // A path with an image extension is not necessarily a readable file: it may
  // be a directory, an unreadable symlink, or a file that simply has the wrong
  // name. Every failure below degrades to "unknown dimensions".
  if (ext === 'jpg' || ext === 'jpeg') return jpegDimensions(path);
  if (ext === 'svg') return svgDimensions(path);

  const b = readBytesNoFollow(path, 64);
  if (!b) return undefined;

  if (ext === 'png') {
    if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50) {
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    return undefined;
  }

  if (ext === 'gif') {
    if (b.length >= 10 && b.toString('ascii', 0, 3) === 'GIF') {
      return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    }
    return undefined;
  }

  if (ext === 'webp') {
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      if (b.toString('ascii', 12, 16) === 'VP8X') {
        return { width: 1 + (b.readUIntLE(24, 3) & 0xffffff), height: 1 + (b.readUIntLE(27, 3) & 0xffffff) };
      }
      if (b.toString('ascii', 12, 16) === 'VP8L') {
        const w = 1 + (((b[21]! & 0x3f) << 8) | b[20]!);
        const h = 1 + (((b[23]! & 0x0f) << 10) | (b[22]! << 2) | ((b[21]! & 0xc0) >> 6));
        return { width: w, height: h };
      }
      if (b.toString('ascii', 12, 16) === 'VP8 ') {
        return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      }
    }
    return undefined;
  }

  return undefined;
}

function svgDimensions(path: string): Dims | undefined {
  const text = readHead(path, 4096);
  const viewBox = text.match(/viewBox=["']([\d.\s-]+)["']/);
  if (viewBox) {
    const parts = viewBox[1]!.trim().split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts[2]! > 0 && parts[3]! > 0) {
      return { width: Math.round(parts[2]!), height: Math.round(parts[3]!) };
    }
  }
  const w = text.match(/<svg[^>]*\swidth=["']([\d.]+)/);
  const h = text.match(/<svg[^>]*\sheight=["']([\d.]+)/);
  if (w && h) return { width: Math.round(Number(w[1])), height: Math.round(Number(h[1])) };
  return undefined;
}

function jpegDimensions(path: string): Dims | undefined {
  const b = readBytesNoFollow(path, 64 * 1024);
  if (!b) return undefined;

  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    const len = b.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return undefined;
}

export function buildMeta(size: number, mtimeMs: number, language?: string): ArtifactMeta {
  return { size, mtimeMs, language };
}
