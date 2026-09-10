import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { renderMarkdown, isSafeUrl, splitFrontmatter } from '../src/parsers/markdown';
import { isWorkspaceRelative } from '../src/security/urlPolicy';
import { parseDiff } from '../src/parsers/diff';
import { parseJson } from '../src/parsers/json';
import { parseLog } from '../src/parsers/log';
import { parseCode } from '../src/parsers/code';

const FIX = (name: string) => resolve(__dirname, 'fixtures', name);

describe('markdown safety', () => {
  it('escapes raw HTML instead of rendering it', () => {
    const html = renderMarkdown('hello <script>alert(1)</script> world');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rejects javascript: link protocols', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html;base64,xxx')).toBe(false);
    expect(isSafeUrl('vbscript:x')).toBe(false);
    expect(isSafeUrl('https://example.com')).toBe(true);
    expect(isSafeUrl('mailto:someone@example.com')).toBe(true);
    expect(isSafeUrl('relative/path')).toBe(true);
    expect(isSafeUrl('#anchor')).toBe(true);
  });

  it('refuses protocol-relative and file: targets', () => {
    // `//host` is an off-site navigation wearing a path's clothes; `file:`
    // reaches the local disk.
    expect(isSafeUrl('//evil.example.com/x')).toBe(false);
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeUrl('blob:https://x/y')).toBe(false);
    expect(isSafeUrl('')).toBe(false);
  });

  it('classifies workspace-relative paths separately from resolvable URLs', () => {
    expect(isWorkspaceRelative('img/shot.png')).toBe(true);
    expect(isWorkspaceRelative('./shot.png')).toBe(true);
    expect(isWorkspaceRelative('/absolute/path.png')).toBe(true);
    expect(isWorkspaceRelative('https://example.com/x.png')).toBe(false);
    expect(isWorkspaceRelative('//example.com/x.png')).toBe(false);
    expect(isWorkspaceRelative('data:image/png;base64,xx')).toBe(false);
  });

  it('renders GFM tables and code fences', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```');
    expect(html).toContain('<table>');
    expect(html).toContain('<pre>');
  });

  it('resolves relative images through the resolver and blocks external', () => {
    const seen: string[] = [];
    renderMarkdown('![alt](./img.png)', (src) => {
      seen.push(src);
      return '/api/file?path=img.png';
    });
    expect(seen).toContain('./img.png');
  });

  it('splits frontmatter', () => {
    const { frontmatter, body } = splitFrontmatter('---\ntitle: Hello\ncount: 3\ndone: true\n---\n\n# Body');
    expect(frontmatter).toMatchObject({ title: 'Hello', count: 3, done: true });
    expect(body).toContain('# Body');
  });
});

describe('diff parser', () => {
  it('parses a unified diff into files and hunks', () => {
    const d = parseDiff(`diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,3 @@
 line1
-line2
+line2 changed
+line3
`);
    expect(d.files).toHaveLength(1);
    const f = d.files[0]!;
    expect(f.path).toBe('a.txt');
    expect(f.status).toBe('modified');
    expect(f.added).toBe(2);
    expect(f.removed).toBe(1);
    const types = f.hunks[0]!.lines.map((l) => l.type);
    expect(types).toEqual(['context', 'del', 'add', 'add']);
  });

  it('parses the mixed fixture diff', () => {
    const d = parseDiff(require('node:fs').readFileSync(FIX('mixed') + '/patches/change.diff', 'utf8'));
    expect(d.files.length).toBe(2);
    expect(d.files[0]!.path).toBe('src/main.ts');
  });
});

describe('json parser', () => {
  it('parses valid JSON', () => {
    const j = parseJson(FIX('mixed') + '/data/result.json');
    expect(j.valid).toBe(true);
    expect((j.data as { count: number }).count).toBe(2);
  });

  it('flags invalid JSON without throwing', () => {
    const j = parseJson(FIX('mixed') + '/misc/unknown.bin');
    expect(j.valid).toBe(false);
  });
});

describe('log parser', () => {
  it('tails long logs and detects errors', () => {
    const log = parseLog(FIX('mixed') + '/logs/build.log');
    expect(log.totalLines).toBe(300);
    expect(log.tail.length).toBeLessThanOrEqual(200);
    expect(log.hasErrors).toBe(true);
    expect(log.errorLines.length).toBeGreaterThan(0);
  });

  it('supports full mode', () => {
    const log = parseLog(FIX('mixed') + '/logs/build.log', true);
    expect(log.tail.length).toBe(300);
  });
});

describe('code parser', () => {
  it('reads code and counts lines', () => {
    const c = parseCode(FIX('mixed') + '/src/main.ts', 'TypeScript');
    expect(c.language).toBe('TypeScript');
    expect(c.totalLines).toBeGreaterThan(3);
    expect(c.raw).toContain('export function add');
  });
});
