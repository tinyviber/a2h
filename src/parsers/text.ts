import { fstatSync, readSync, closeSync } from 'node:fs';
import { openNoFollow, readFileNoFollow } from '../util/safeRead';

// Shared text-file reading helpers with hard size caps, so no single file can
// blow up memory. Logs / code / json / markdown all route through these.
//
// Every read here refuses to follow a symlink. These helpers are reached from
// more than one entry point (artifact content, producer-authored blocks), so
// the guarantee is enforced once, at the choke point, rather than at each call
// site. A symlink fails the open and surfaces as "unreadable".

export interface TextResult {
  text: string;
  truncated: boolean;
  totalBytes: number;
}

/**
 * Lenient whole-file read for preview rendering: an unreadable file comes back
 * as empty text rather than throwing, because a preview that cannot be built
 * should still render as something. The symlink guarantee lives in
 * `readFileNoFollow`, which is the only implementation of "read a whole file
 * without following a link".
 */
export function readFileText(path: string, maxBytes: number): TextResult {
  const read = readFileNoFollow(path, maxBytes);
  if (!read) return { text: '', truncated: false, totalBytes: 0 };
  return { text: read.text, truncated: read.truncated, totalBytes: read.totalBytes };
}

export interface LinesResult {
  lines: string[];
  truncated: boolean;
}

/** Splits text into lines, dropping a single trailing newline. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Streams the file counting newlines, capped at maxBytes. */
export function countLinesFull(path: string, maxBytes: number): LinesResult {
  let fd;
  try {
    fd = openNoFollow(path);
    const stat = fstatSync(fd);
    const totalBytes = stat.size;
    const toScan = Math.min(totalBytes, maxBytes);
    const chunk = 256 * 1024;
    const buf = Buffer.alloc(chunk);
    let offset = 0;
    let lines = 0;
    let truncated = false;
    while (offset < toScan) {
      const want = Math.min(chunk, toScan - offset);
      const n = readSync(fd, buf, 0, want, offset);
      if (n <= 0) break;
      for (let i = 0; i < n; i++) if (buf[i] === 0x0a) lines++;
      offset += n;
    }
    truncated = totalBytes > maxBytes;
    return { lines: [String(lines)], truncated };
  } catch {
    return { lines: [], truncated: false };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Reads the last `count` lines of a file efficiently (from the end). */
export function readTailLines(path: string, count: number): LinesResult {
  let fd;
  try {
    fd = openNoFollow(path);
    const stat = fstatSync(fd);
    const totalBytes = stat.size;
    // Read the final chunk; expand if we did not collect enough lines.
    let chunk = 64 * 1024;
    let text = '';
    let truncated = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const start = Math.max(0, totalBytes - chunk);
      const len = totalBytes - start;
      const buf = Buffer.alloc(len);
      const n = readSync(fd, buf, 0, len, start);
      text = buf.slice(0, n).toString('utf8');
      const lines = splitLines(text);
      if (lines.length >= count || start === 0) {
        truncated = totalBytes > chunk;
        return { lines: lines.slice(-count), truncated };
      }
      chunk *= 4;
    }
    const lines = splitLines(text);
    return { lines: lines.slice(-count), truncated: true };
  } catch {
    return { lines: [], truncated: false };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
