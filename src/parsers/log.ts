import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import type { LogContent } from '../types';
import { countLinesFull, readFileText, readTailLines, splitLines } from './text';
import { LOG_TAIL_LINES } from '../scanner/ignore';

const ERROR_RE = /\b(error|fatal|exception|panic|traceback|crashed|failed)\b/i;
const WARN_RE = /\b(warn|warning|deprecated)\b/i;

const MAX_FULL_BYTES = 512 * 1024;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

export function parseLog(path: string, full = false): LogContent {
  if (full) return parseFull(path);
  return parseTail(path);
}

function parseTail(path: string): LogContent {
  const { lines: tail, truncated } = readTailLines(path, LOG_TAIL_LINES);
  const counted = countLinesFull(path, MAX_SCAN_BYTES);
  const totalLines = counted.lines[0] ? Number(counted.lines[0]) : tail.length;

  // Error/warning detection scans the whole file (capped), so errors buried
  // far from the tail are still surfaced as flags with their line numbers.
  const { hasErrors, hasWarnings, errorLines } = scanErrors(path, MAX_SCAN_BYTES);

  return { type: 'log', tail, totalLines, truncated, hasErrors, hasWarnings, errorLines };
}

function parseFull(path: string): LogContent {
  const { text, truncated } = readFileText(path, MAX_FULL_BYTES);
  const lines = splitLines(text);
  const totalLines = lines.length;
  const { hasErrors, hasWarnings, errorLines } = scanLines(lines, 0);
  return { type: 'log', tail: lines, totalLines, truncated, hasErrors, hasWarnings, errorLines };
}

function scanLines(lines: string[], offset: number) {
  let hasErrors = false;
  let hasWarnings = false;
  const errorLines: number[] = [];
  lines.forEach((line, i) => {
    if (ERROR_RE.test(line)) {
      hasErrors = true;
      errorLines.push(offset + i);
    } else if (WARN_RE.test(line)) {
      hasWarnings = true;
    }
  });
  return { hasErrors, hasWarnings, errorLines };
}

/** Streams the file (capped at maxBytes) and reports error/warning lines. */
function scanErrors(path: string, maxBytes: number) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const stat = fstatSync(fd);
    const toScan = Math.min(stat.size, maxBytes);
    const chunk = 256 * 1024;
    const buf = Buffer.alloc(chunk);
    let offset = 0;
    let lineNo = 0;
    let line = '';
    let hasErrors = false;
    let hasWarnings = false;
    const errorLines: number[] = [];

    while (offset < toScan) {
      const want = Math.min(chunk, toScan - offset);
      const n = readSync(fd, buf, 0, want, offset);
      if (n <= 0) break;
      const s = buf.slice(0, n).toString('utf8');
      for (let i = 0; i < s.length; i++) {
        const ch = s[i]!;
        if (ch === '\n') {
          if (ERROR_RE.test(line)) { hasErrors = true; errorLines.push(lineNo); }
          else if (WARN_RE.test(line)) hasWarnings = true;
          line = '';
          lineNo++;
        } else if (ch !== '\r') {
          line += ch;
        }
      }
      offset += n;
    }
    if (line.length > 0) {
      if (ERROR_RE.test(line)) { hasErrors = true; errorLines.push(lineNo); }
      else if (WARN_RE.test(line)) hasWarnings = true;
    }
    return { hasErrors, hasWarnings, errorLines };
  } catch {
    return { hasErrors: false, hasWarnings: false, errorLines: [] as number[] };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
