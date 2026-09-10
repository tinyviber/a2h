import { describe, it, expect } from 'vitest';
import { Workspace } from '../src/server/workspace';
import { makeWorkspace, manifest, writeFiles, symlink } from './helpers/ws';

// The precedence contract:
//   explicit semantics > producer metadata > conventions > heuristic inference
// Everything below is about holding that line.

const NOTES = '# Notes\n\nFirst prose line.\n';

/** All artifact views in the workspace, flattened. */
function artifacts(ws: Workspace) {
  return ws.presentation.sections.flatMap((s) => s.artifacts);
}

function find(ws: Workspace, id: string) {
  return artifacts(ws).find((a) => a.id === id);
}

function sectionIds(ws: Workspace) {
  return ws.presentation.sections.map((s) => s.id);
}

describe('zero-config fallback', () => {
  it('still works with no manifest at all', () => {
    const root = makeWorkspace({
      'README.md': '# Plain repo\n\nA readme.\n',
      'outputs/report.md': '# Q3\n\nNumbers.\n',
      'logs/build.log': 'line\n'.repeat(10),
    });
    const ws = new Workspace(root);

    expect(ws.presentation.semantics).toBe('inferred');
    expect(ws.presentation.warnings).toEqual([]);
    // Convention-driven placement is unchanged by the semantics layer.
    expect(sectionIds(ws)).toContain('overview');
    expect(sectionIds(ws)).toContain('reports');
    expect(sectionIds(ws)).toContain('logs');
    expect(find(ws, 'README.md')?.source).toBe('convention');
    expect(find(ws, 'outputs/report.md')?.kind).toBe('report');
  });

  it('leaves the task surface empty when nothing declared one', () => {
    const ws = new Workspace(makeWorkspace({ 'README.md': '# Hi\n' }));
    expect(ws.presentation.tasks).toEqual([]);
    expect(ws.presentation.runs).toEqual([]);
    expect(ws.presentation.actions).toEqual([]);
  });

  it('derives a name from the README when the producer stays silent', () => {
    const ws = new Workspace(makeWorkspace({ 'README.md': '# Inferred Name\n\nBody.\n' }));
    expect(ws.presentation.identity.name).toBe('Inferred Name');
  });
});

describe('explicit semantics override inference', () => {
  it('applies a producer role, group and priority', () => {
    const root = makeWorkspace({
      ...manifest({
        a2h: 1,
        groups: [{ id: 'runs', title: 'Runs' }],
        items: [
          {
            path: 'notes.md',
            role: 'run-note',
            group: 'runs',
            priority: 900,
            tags: ['final'],
            summary: 'Declared summary.',
          },
        ],
      }),
      'notes.md': NOTES,
    });
    const ws = new Workspace(root);

    expect(ws.presentation.semantics).toBe('explicit');
    const a = find(ws, 'notes.md')!;
    expect(a.kind).toBe('run-note');
    expect(a.group).toBe('runs');
    // A declared name outranks the README/directory inference.
    expect(a.priority).toBe(900);
    expect(a.tags).toContain('final');
    expect(a.summary).toBe('Declared summary.');
    expect(a.source).toBe('explicit');
    expect(sectionIds(ws)).toContain('runs');
    expect(ws.presentation.sections.find((s) => s.id === 'runs')?.explicit).toBe(true);
  });

  it('puts a producer role the core has never heard of into a readable home', () => {
    const root = makeWorkspace({
      ...manifest({
        a2h: 1,
        groups: [{ id: 'evidence', title: 'Evidence' }],
        items: [{ path: 'shot.png', role: 'totally-invented-role', group: 'evidence' }],
      }),
      'shot.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    const ws = new Workspace(root);

    const a = find(ws, 'shot.png')!;
    expect(a.kind).toBe('totally-invented-role');
    expect(sectionIds(ws)).toContain('evidence');
  });

  it('honours a declared workspace name and summary', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, name: 'Declared', summary: 'Declared summary.' }),
      'README.md': '# README Heading\n\nBody.\n',
    });
    const ws = new Workspace(root);

    expect(ws.presentation.identity.name).toBe('Declared');
    expect(ws.presentation.identity.summary).toBe('Declared summary.');
  });

  it('hides an item the producer marked hidden', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, items: [{ path: 'secret-notes.md', hidden: true }] }),
      'secret-notes.md': NOTES,
      'README.md': '# Hi\n',
    });
    const ws = new Workspace(root);
    expect(find(ws, 'secret-notes.md')).toBeUndefined();
  });

  it('gives an ungrouped producer item a section instead of dropping it', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, items: [{ path: 'outputs/final.md', role: 'summary' }] }),
      'outputs/final.md': '# Final\n',
    });
    const ws = new Workspace(root);

    const a = find(ws, 'outputs/final.md');
    expect(a).toBeDefined();
    // It has a producer role but no group, so a section must still claim it.
    expect(artifacts(ws).some((x) => x.id === 'outputs/final.md')).toBe(true);
  });
});

describe('frontmatter is producer metadata, below the manifest', () => {
  it('reads prefixed keys from a markdown frontmatter block', () => {
    const root = makeWorkspace({
      'notes/plan.md': [
        '---',
        'a2h_role: plan',
        'a2h_group: thinking',
        'a2h_priority: 750',
        'a2h_tags: wip, review',
        'a2h_summary: From frontmatter.',
        '---',
        '',
        '# Plan',
        '',
      ].join('\n'),
    });
    const ws = new Workspace(root);

    const a = find(ws, 'notes/plan.md')!;
    expect(a.kind).toBe('plan');
    expect(a.group).toBe('thinking');
    expect(a.priority).toBe(750);
    expect(a.tags).toEqual(expect.arrayContaining(['wip', 'review']));
    expect(a.summary).toBe('From frontmatter.');
    expect(a.source).toBe('frontmatter');
  });

  it('ignores unprefixed prose frontmatter', () => {
    const root = makeWorkspace({
      'post.md': '---\ntitle: A blog post\ntags: personal\n---\n\n# Post\n',
      'README.md': '# Hi\n',
    });
    const ws = new Workspace(root);

    const a = find(ws, 'post.md')!;
    // `title`/`tags` are some other tool's business, not A2H's.
    expect(a.source).not.toBe('frontmatter');
    expect(a.tags ?? []).not.toContain('personal');
  });

  it('lets the manifest win field-by-field, not record-by-record', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, items: [{ path: 'notes/plan.md', group: 'declared' }] }),
      'notes/plan.md': ['---', 'a2h_group: from-frontmatter', 'a2h_role: plan', '---', '# Plan', ''].join('\n'),
    });
    const ws = new Workspace(root);

    const a = find(ws, 'notes/plan.md')!;
    // Manifest supplies the group…
    expect(a.group).toBe('declared');
    // …while the role still comes from frontmatter. No field is clobbered.
    expect(a.kind).toBe('plan');
  });

  it('never lets a symlink contribute frontmatter', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    // A link that looks like markdown but points at something outside.
    symlink(root, 'linked.md', '/etc/hosts');
    const ws = new Workspace(root);

    const a = find(ws, 'linked.md')!;
    expect(a.source).not.toBe('frontmatter');
    expect(ws.renderPayload('linked.md')?.content).toMatchObject({ note: 'Symlink (not followed)' });
  });
});

describe('robustness of the producer protocol', () => {
  it('degrades to a warning — never a crash — on a malformed manifest', () => {
    const root = makeWorkspace({
      '.a2h/manifest.json': '{ this is not json',
      'README.md': '# Still works\n',
    });
    const ws = new Workspace(root);

    expect(ws.presentation.warnings.join(' ')).toMatch(/could not parse/i);
    // The zero-config reading of the workspace survives a broken producer.
    expect(ws.presentation.semantics).toBe('inferred');
    expect(find(ws, 'README.md')).toBeDefined();
  });

  it('warns but continues when a manifest section has the wrong shape', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, tasks: 'not-an-array', items: [{ path: 'README.md' }] }),
      'README.md': '# Hi\n',
    });
    const ws = new Workspace(root);

    expect(ws.presentation.warnings.join(' ')).toMatch(/"tasks" must be an array/);
    expect(find(ws, 'README.md')).toBeDefined();
  });

  it('skips items that would be unusable and says so', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, items: [{ role: 'no-path' }, { path: '' }] }),
      'README.md': '# Hi\n',
    });
    const ws = new Workspace(root);
    expect(ws.presentation.warnings.join(' ')).toMatch(/missing "path"/);
  });

  it('ignores unknown top-level keys instead of failing', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, somethingFromTheFuture: { nested: true }, items: [] }),
      'README.md': '# Hi\n',
    });
    const ws = new Workspace(root);
    expect(find(ws, 'README.md')).toBeDefined();
  });
});

describe('append-only producers', () => {
  it('reads run records dropped into .a2h/runs one file at a time', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, tasks: [{ id: 't1', title: 'Task one' }] }),
      '.a2h/runs/2026-01-01-a.json': JSON.stringify({
        id: 'run-from-file',
        taskId: 't1',
        title: 'Dropped in by a run',
        status: 'succeeded',
        steps: [{ title: 'Step', status: 'succeeded' }],
      }),
      'README.md': '# Hi\n',
    });
    const ws = new Workspace(root);

    const run = ws.presentation.runs.find((r) => r.id === 'run-from-file');
    expect(run).toBeDefined();
    expect(run!.taskId).toBe('t1');
  });

  it('accepts a { runs: [...] } wrapper in a run file', () => {
    const root = makeWorkspace({
      '.a2h/runs/batch.json': JSON.stringify({
        runs: [{ id: 'a' }, { id: 'b' }],
      }),
      'README.md': '# Hi\n',
    });
    const ws = new Workspace(root);
    const ids = ws.presentation.runs.map((r) => r.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });

  it('keeps working after a run file is added', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    const ws = new Workspace(root);
    expect(ws.presentation.runs).toEqual([]);

    writeFiles(root, { '.a2h/runs/late.json': JSON.stringify({ id: 'late-run' }) });
    ws.rescan();

    expect(ws.presentation.runs.map((r) => r.id)).toContain('late-run');
  });
});

describe('semantics origin reporting', () => {
  it('is "inferred" with no producer input', () => {
    const ws = new Workspace(makeWorkspace({ 'README.md': '# Hi\n' }));
    expect(ws.presentation.semantics).toBe('inferred');
  });

  it('is "explicit" once a manifest exists', () => {
    const ws = new Workspace(
      makeWorkspace({ ...manifest({ a2h: 1, items: [{ path: 'README.md' }] }), 'README.md': '# Hi\n' }),
    );
    expect(ws.presentation.semantics).toBe('explicit');
  });
});
