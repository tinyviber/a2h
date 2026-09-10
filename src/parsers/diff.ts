import { parsePatch } from 'diff';
import type { DiffContent, DiffFile, DiffHunk, DiffLine } from '../types';

// Converts a unified diff / patch into a structured form the renderer can lay
// out for review. Uses the `diff` package's battle-tested patch parser, then
// reshapes it into our own IR (so renderers never depend on `diff` types).

const MAX_DIFF_LINES = 6000;

export function parseDiff(text: string): DiffContent {
  const parsed = parsePatch(text);

  let files: DiffFile[];
  if (parsed.length === 0) {
    files = [rawFallback(text)];
  } else {
    files = parsed.map(convertFile);
  }

  let totalLines = 0;
  let truncated = false;
  for (const f of files) {
    for (const h of f.hunks) totalLines += h.lines.length;
  }
  if (totalLines > MAX_DIFF_LINES) {
    truncated = true;
    files = truncateFiles(files, MAX_DIFF_LINES);
    totalLines = MAX_DIFF_LINES;
  }

  return { type: 'diff', files, totalLines, truncated };
}

function convertFile(p: {
  oldFileName?: string;
  newFileName?: string;
  oldHeader?: string;
  newHeader?: string;
  hunks: {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }[];
}): DiffFile {
  const oldName = stripGitPrefix(p.oldFileName ?? '');
  const newName = stripGitPrefix(p.newFileName ?? '');
  const path = newName || oldName || '(unknown)';

  let status: DiffFile['status'] = 'modified';
  if (!p.oldFileName || p.oldFileName === '/dev/null') status = 'added';
  else if (!p.newFileName || p.newFileName === '/dev/null') status = 'removed';
  else if (oldName !== newName) status = 'renamed';

  let added = 0;
  let removed = 0;

  const hunks: DiffHunk[] = p.hunks.map((h) => {
    const lines: DiffLine[] = [];
    let oldNo = h.oldStart;
    let newNo = h.newStart;

    for (const raw of h.lines) {
      const text = raw.replace(/\n$/, '');
      if (text === '\\ No newline at end of file') {
        lines.push({ type: 'context', text });
        continue;
      }
      const ch = raw[0];
      if (ch === '+') {
        added++;
        lines.push({ type: 'add', text: raw.slice(1), newNo });
        newNo++;
      } else if (ch === '-') {
        removed++;
        lines.push({ type: 'del', text: raw.slice(1), oldNo });
        oldNo++;
      } else {
        const body = ch === ' ' ? raw.slice(1) : raw;
        lines.push({ type: 'context', text: body, oldNo, newNo });
        oldNo++;
        newNo++;
      }
    }

    return { header: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`, lines };
  });

  return {
    path,
    from: p.oldFileName ? stripGitPrefix(p.oldFileName) : undefined,
    to: p.newFileName ? stripGitPrefix(p.newFileName) : undefined,
    status,
    added,
    removed,
    hunks,
  };
}

function stripGitPrefix(name: string): string {
  return name.replace(/^[ab]\//, '');
}

function rawFallback(text: string): DiffFile {
  const lines = text
    .split(/\r?\n/)
    .map((line): DiffLine => ({ type: 'context', text: line }));
  return {
    path: '(patch)',
    status: 'modified',
    added: 0,
    removed: 0,
    hunks: [{ header: '', lines }],
  };
}

function truncateFiles(files: DiffFile[], maxLines: number): DiffFile[] {
  const out: DiffFile[] = [];
  let budget = maxLines;
  for (const f of files) {
    if (budget <= 0) break;
    const copy: DiffFile = { ...f, hunks: [] };
    for (const h of f.hunks) {
      if (budget <= 0) break;
      const take = h.lines.slice(0, budget);
      copy.hunks.push({ header: h.header, lines: take });
      budget -= take.length;
    }
    out.push(copy);
  }
  return out;
}
