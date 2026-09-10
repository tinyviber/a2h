import { describe, it, expect } from 'vitest';
import { Workspace } from '../src/server/workspace';
import { makeWorkspace, manifest, fixturePng } from './helpers/ws';

// The presentation layer is what a human actually sees. These tests cover the
// translation from semantics to a render-ready view, and the fact that the
// renderer is chosen by *content*, not by the role a producer invented.

function ws(files: Parameters<typeof makeWorkspace>[0]) {
  return new Workspace(makeWorkspace(files));
}

function view(w: Workspace, id: string) {
  return w.presentation.sections.flatMap((s) => s.artifacts).find((a) => a.id === id);
}

describe('artifacts publish how they should be drawn', () => {
  const FILES = {
    'README.md': '# Hi\n',
    'notes.md': '# Notes\n\nProse.\n',
    'src/main.ts': 'export const x = 1;\n',
    'data/rows.json': '{"rows":[1,2]}',
    'logs/build.log': 'line\n'.repeat(5),
    'patches/change.diff': 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n',
    'shot.png': fixturePng(),
    'misc/thing.unknownext': Buffer.from([0x00, 0xff]),
  };

  it('reports the content kind for every artifact', () => {
    const w = ws(FILES);
    expect(view(w, 'README.md')?.content).toBe('markdown');
    expect(view(w, 'notes.md')?.content).toBe('markdown');
    expect(view(w, 'src/main.ts')?.content).toBe('code');
    expect(view(w, 'data/rows.json')?.content).toBe('json');
    expect(view(w, 'logs/build.log')?.content).toBe('log');
    expect(view(w, 'patches/change.diff')?.content).toBe('diff');
    expect(view(w, 'shot.png')?.content).toBe('image');
    expect(view(w, 'misc/thing.unknownext')?.content).toBe('file');
  });

  it('renders by content even when the producer renamed the role', () => {
    const w = ws({
      ...manifest({
        a2h: 1,
        items: [
          { path: 'notes.md', role: 'spec' },
          { path: 'shot.png', role: 'evidence' },
          { path: 'patches/change.diff', role: 'the-change' },
        ],
      }),
      ...FILES,
    });

    // The roles are the producer's; the rendering is still correct.
    expect(view(w, 'notes.md')?.kind).toBe('spec');
    expect(view(w, 'notes.md')?.content).toBe('markdown');
    expect(view(w, 'shot.png')?.kind).toBe('evidence');
    expect(view(w, 'shot.png')?.content).toBe('image');
    expect(w.renderPayload('notes.md')?.content.type).toBe('markdown');
    expect(w.renderPayload('shot.png')?.content.type).toBe('image');
    expect(w.renderPayload('patches/change.diff')?.content.type).toBe('diff');
  });

  it('still enriches an artifact whose role the core does not know', () => {
    const w = ws({
      ...manifest({ a2h: 1, items: [{ path: 'notes.md', role: 'invented' }] }),
      'notes.md': '# A Real Heading\n\nA summary line.\n',
      'shot.png': fixturePng(),
    });

    // Enrichment follows content, so a made-up role loses nothing.
    expect(view(w, 'notes.md')?.title).toBe('A Real Heading');
    expect(view(w, 'notes.md')?.summary).toBe('A summary line.');
    expect(view(w, 'shot.png')?.meta?.imageWidth).toBe(320);
  });

  it('reports the group a producer assigned', () => {
    const w = ws({
      ...manifest({
        a2h: 1,
        groups: [{ id: 'g1', title: 'Group one' }],
        items: [{ path: 'notes.md', group: 'g1' }],
      }),
      'notes.md': '# Notes\n',
    });
    expect(view(w, 'notes.md')?.group).toBe('g1');
  });

  it('counts files touched by a diff, not lines', () => {
    const w = ws({
      'README.md': '# Hi\n',
      'change.diff': [
        'diff --git a/one.ts b/one.ts',
        '--- a/one.ts',
        '+++ b/one.ts',
        '@@ -1 +1,2 @@',
        ' const a = 1;',
        '+const b = 2;',
        'diff --git a/two.ts b/two.ts',
        '--- a/two.ts',
        '+++ b/two.ts',
        '@@ -1 +1 @@',
        '-const c = 3;',
        '+const c = 4;',
        '',
      ].join('\n'),
    });

    const v = view(w, 'change.diff')!;
    expect(v.meta?.fileCount).toBe(2);
    // A two-file patch must never describe itself as "2 lines".
    expect(v.meta?.lineCount).toBeUndefined();
    expect(v.summary).toContain('2 files');
  });

  it('passes declared relations and metrics through to the view', () => {
    const w = ws({
      ...manifest({
        a2h: 1,
        items: [
          {
            path: 'notes.md',
            relations: [{ kind: 'produced-by', target: './src/main.ts' }],
            metrics: [{ label: 'score', value: 0.9, tone: 'good' }],
          },
        ],
      }),
      'notes.md': '# Notes\n',
      'src/main.ts': 'export {};\n',
    });

    const v = view(w, 'notes.md')!;
    expect(v.relations?.[0]).toMatchObject({ kind: 'produced-by', target: 'src/main.ts' });
    expect(v.metrics?.[0]).toMatchObject({ label: 'score', value: 0.9 });
  });
});

describe('groups become the sections a human reads', () => {
  const DOC = {
    a2h: 1,
    groups: [
      { id: 'b', title: 'Second', order: 2 },
      { id: 'a', title: 'First', order: 1 },
      { id: 'empty', title: 'Nothing here', order: 3 },
    ],
    items: [
      { path: 'notes.md', group: 'b' },
      { path: 'src/main.ts', group: 'a' },
      { path: 'README.md' },
    ],
  };

  it('orders sections by the producer order, not by declaration order', () => {
    const w = ws({ ...manifest(DOC), 'notes.md': '# N\n', 'src/main.ts': 'export {};\n', 'README.md': '# Hi\n' });
    const ids = w.presentation.sections.map((s) => s.id);
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
  });

  it('uses the producer title as the section title', () => {
    const w = ws({ ...manifest(DOC), 'notes.md': '# N\n', 'src/main.ts': 'export {};\n', 'README.md': '# Hi\n' });
    const a = w.presentation.sections.find((s) => s.id === 'a')!;
    expect(a.title).toBe('First');
    expect(a.explicit).toBe(true);
  });

  it('omits a group that ended up with nothing in it', () => {
    const w = ws({ ...manifest(DOC), 'notes.md': '# N\n', 'src/main.ts': 'export {};\n', 'README.md': '# Hi\n' });
    expect(w.presentation.sections.map((s) => s.id)).not.toContain('empty');
  });

  it('still finds a home for an artifact no group claimed', () => {
    const w = ws({ ...manifest(DOC), 'notes.md': '# N\n', 'src/main.ts': 'export {};\n', 'README.md': '# Hi\n' });
    expect(view(w, 'README.md')).toBeDefined();
    const overview = w.presentation.sections.find((s) => s.id === 'overview')!;
    expect(overview.explicit).toBeFalsy();
    expect(overview.artifacts.map((a) => a.id)).toContain('README.md');
  });

  it('keeps ungrouped artifacts even when every group is used', () => {
    const w = ws({
      ...manifest({ a2h: 1, groups: [{ id: 'g', title: 'G' }], items: [{ path: 'notes.md', group: 'g' }] }),
      'notes.md': '# N\n',
      'loose.md': '# Loose\n',
    });
    expect(view(w, 'loose.md')).toBeDefined();
  });
});

describe('blocks written by a producer', () => {
  it('compiles a markdown block written as literal text', () => {
    const w = ws({
      ...manifest({
        a2h: 1,
        panels: [{ type: 'markdown', title: 'Note', text: '# Heading\n\nSome *prose*.\n' }],
      }),
      'README.md': '# Hi\n',
    });

    const panel = w.presentation.panels[0] as { html?: string; title?: string };
    expect(panel.title).toBe('Note');
    expect(panel.html).toContain('<h1>Heading</h1>');
    expect(panel.html).toContain('<em>prose</em>');
  });

  it('compiles a markdown block that references a file', () => {
    const w = ws({
      ...manifest({
        a2h: 1,
        panels: [{ type: 'markdown', path: 'reports/summary.md' }],
      }),
      'README.md': '# Hi\n',
      'reports/summary.md': '## From a file\n\nBody.\n',
    });

    expect((w.presentation.panels[0] as { html: string }).html).toContain('From a file');
  });

  it('escapes markup inside a producer-authored markdown block', () => {
    const w = ws({
      ...manifest({
        a2h: 1,
        panels: [{ type: 'markdown', text: '<script>alert(1)</script>\n' }],
      }),
      'README.md': '# Hi\n',
    });

    const html = (w.presentation.panels[0] as { html: string }).html;
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('rewrites a relative image to a servable url', () => {
    const w = ws({
      ...manifest({
        a2h: 1,
        panels: [{ type: 'markdown', path: 'reports/summary.md' }],
      }),
      'README.md': '# Hi\n',
      'reports/summary.md': '![shot](../shot.png)\n',
      'shot.png': fixturePng(),
    });

    const html = (w.presentation.panels[0] as { html: string }).html;
    expect(html).toContain('/api/file?path=');
    expect(html).toContain(encodeURIComponent('shot.png'));
  });

  it('drops a block that points at a file which is not there', () => {
    const w = ws({
      ...manifest({ a2h: 1, panels: [{ type: 'markdown', path: 'nope/missing.md' }] }),
      'README.md': '# Hi\n',
    });
    // An empty panel list is better than an empty frame.
    expect(w.presentation.panels).toEqual([]);
  });

  it('passes an unknown block type through untouched', () => {
    const w = ws({
      ...manifest({
        a2h: 1,
        panels: [{ type: 'hologram', title: 'From the future', payload: { x: 1 } }],
      }),
      'README.md': '# Hi\n',
    });

    // Forward compatibility: the server must not drop what it cannot draw.
    const panel = w.presentation.panels[0] as { type: string; payload: unknown };
    expect(panel.type).toBe('hologram');
    expect(panel.payload).toEqual({ x: 1 });
  });

  it('drops a block with no usable type and warns', () => {
    const w = ws({
      ...manifest({ a2h: 1, panels: [{ title: 'No type' }, { type: 'notice', text: 'Kept.' }] }),
      'README.md': '# Hi\n',
    });

    expect(w.presentation.panels).toHaveLength(1);
    expect(w.presentation.warnings.join(' ')).toMatch(/missing a string "type"/);
  });

  it('keeps rich block shapes intact for the client to draw', () => {
    const panels = [
      { type: 'metrics', title: 'Numbers', items: [{ label: 'items', value: 34 }] },
      { type: 'timeline', items: [{ at: '2026-01-01', title: 'Started' }] },
      { type: 'comparison', options: [{ title: 'A', facts: [{ label: 'x', value: '1' }] }] },
      { type: 'table', columns: [{ key: 'a', label: 'A' }], rows: [{ a: '1' }] },
      { type: 'keyvalue', items: [{ key: 'branch', value: 'main', mono: true }] },
      { type: 'status', status: 'blocked', detail: 'waiting' },
      { type: 'notice', tone: 'warn', text: 'careful' },
      { type: 'list', items: [{ title: 'one' }] },
    ];
    const w = ws({ ...manifest({ a2h: 1, panels }), 'README.md': '# Hi\n' });

    expect(w.presentation.panels.map((b) => b.type)).toEqual([
      'metrics', 'timeline', 'comparison', 'table', 'keyvalue', 'status', 'notice', 'list',
    ]);
  });

  it('attaches blocks to the artifact they were declared on', () => {
    const w = ws({
      ...manifest({
        a2h: 1,
        items: [
          {
            path: 'notes.md',
            blocks: [{ type: 'markdown', text: '## Aside\n\nContext.\n' }],
          },
        ],
      }),
      'notes.md': '# Notes\n',
    });

    const payload = w.renderPayload('notes.md')!;
    expect(payload.blocks).toHaveLength(1);
    expect((payload.blocks![0] as { html: string }).html).toContain('Aside');
  });

  it('attaches blocks to the task they were declared on', () => {
    const w = ws({
      ...manifest({
        a2h: 1,
        tasks: [
          {
            id: 't',
            title: 'T',
            blocks: [{ type: 'markdown', text: '## Task note\n' }],
          },
        ],
      }),
      'README.md': '# Hi\n',
    });

    const task = w.presentation.tasks[0]!;
    expect(task.blocks).toHaveLength(1);
    expect((task.blocks![0] as { html: string }).html).toContain('Task note');
  });
});

describe('highlights', () => {
  it('surfaces the most important artifacts first', () => {
    const w = ws({
      'README.md': '# Hi\n',
      'outputs/final-report.md': '# Final\n',
      'log/build.log': 'x\n',
      'src/main.ts': 'export {};\n',
    });

    const ids = w.presentation.highlights.map((a) => a.id);
    expect(ids).toContain('outputs/final-report.md');
    // The README is the workspace summary, not a highlight.
    expect(ids).not.toContain('README.md');
  });

  it('is capped so the top of the page stays readable', () => {
    const files: Record<string, string> = { 'README.md': '# Hi\n' };
    for (let i = 0; i < 30; i++) files[`outputs/r${i}.md`] = `# Report ${i}\n`;
    const w = ws(files);
    expect(w.presentation.highlights.length).toBeLessThanOrEqual(8);
  });
});
