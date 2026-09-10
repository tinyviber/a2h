import { describe, it, expect } from 'vitest';
import { Workspace } from '../src/server/workspace';
import { makeWorkspace, manifest } from './helpers/ws';

// Task / run / action as a minimal protocol: enough for a human to see what is
// in flight, what happened, and what they are being asked to decide.

const DOC = {
  a2h: 1,
  name: 'Workflow demo',
  tasks: [
    {
      id: 'review',
      title: 'Review the candidate',
      status: 'running',
      summary: 'Waiting on a human sign-off.',
      owner: 'radar-agent',
      updatedAt: '2026-01-02T03:04:05Z',
      progress: { done: 3, total: 4, label: 'steps' },
      metrics: [
        { label: 'sources', value: 34 },
        { label: 'confidence', value: 0.81, tone: 'good' },
      ],
      actions: ['approve', 'reject'],
      artifacts: ['drafts/candidate.md', 'data/clusters.json'],
    },
    {
      id: 'collect',
      title: 'Collect sources',
      status: 'succeeded',
      artifacts: ['data/clusters.json'],
    },
    {
      id: 'orphan',
      title: 'A task whose artifacts do not exist',
      artifacts: ['gone/missing.md'],
    },
  ],
  runs: [
    {
      id: 'run-1',
      taskId: 'review',
      title: 'Cluster and draft',
      status: 'succeeded',
      startedAt: '2026-01-02T03:00:00Z',
      endedAt: '2026-01-02T03:04:00Z',
      durationMs: 240_000,
      summary: 'Clustered 34 items into 3 drafts.',
      artifacts: ['drafts/candidate.md'],
      steps: [
        { id: 's1', title: 'Fetch', status: 'succeeded' },
        { id: 's2', title: 'Cluster', status: 'succeeded', detail: '3 clusters' },
        { id: 's3', title: 'Human sign-off', status: 'pending', detail: 'needs a person' },
      ],
    },
    {
      id: 'run-2',
      taskId: 'collect',
      title: 'Ingest',
      status: 'succeeded',
      steps: [{ title: 'Read feeds', status: 'succeeded' }],
    },
  ],
  actions: [
    { id: 'approve', label: 'Approve', kind: 'approve', taskId: 'review', sideEffect: 'state' },
    { id: 'reject', label: 'Reject', kind: 'reject', taskId: 'review', sideEffect: 'state' },
    { id: 'publish', label: 'Publish', kind: 'publish', taskId: 'review', sideEffect: 'external' },
    { id: 'run-again', label: 'Run again', kind: 'run', taskId: 'collect', sideEffect: 'state' },
  ],
  items: [
    { path: 'drafts/candidate.md', role: 'draft', taskId: 'review', group: 'drafts' },
    { path: 'data/clusters.json', role: 'dataset', group: 'data' },
  ],
};

const FILES = {
  'drafts/candidate.md': '# Candidate\n\nBody.\n',
  'data/clusters.json': '{"clusters":[]}',
};

function ws() {
  return new Workspace(makeWorkspace({ ...manifest(DOC), ...FILES }));
}

describe('tasks', () => {
  it('lists every declared task', () => {
    expect(ws().presentation.tasks.map((t) => t.id)).toEqual(['review', 'collect', 'orphan']);
  });

  it('carries the declared status, owner, progress and metrics', () => {
    const task = ws().presentation.tasks.find((t) => t.id === 'review')!;
    expect(task.status).toBe('running');
    expect(task.owner).toBe('radar-agent');
    expect(task.updatedAt).toBe('2026-01-02T03:04:05Z');
    expect(task.progress).toEqual({ done: 3, total: 4, label: 'steps' });
    expect(task.metrics?.map((m) => m.label)).toEqual(['sources', 'confidence']);
  });

  it('keeps a status it does not recognise instead of rewriting it', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, tasks: [{ id: 't', title: 'T', status: 'waiting-on-vendor' }] }),
      'README.md': '# Hi\n',
    });
    const task = new Workspace(root).presentation.tasks[0]!;
    // Open vocabulary: an unknown status still renders, with neutral styling.
    expect(task.status).toBe('waiting-on-vendor');
  });

  it('defaults a missing status rather than leaving it blank', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, tasks: [{ id: 't', title: 'T' }] }),
      'README.md': '# Hi\n',
    });
    expect(new Workspace(root).presentation.tasks[0]!.status).toBe('pending');
  });

  it('unions declared artifacts with items that point at the task', () => {
    const task = ws().presentation.tasks.find((t) => t.id === 'review')!;
    expect(task.artifacts).toContain('drafts/candidate.md');
    expect(task.artifacts).toContain('data/clusters.json');
  });

  it('drops artifacts that do not exist rather than rendering dead links', () => {
    const task = ws().presentation.tasks.find((t) => t.id === 'orphan')!;
    expect(task.artifacts).toEqual([]);
  });

  it('does not list the same artifact twice', () => {
    const task = ws().presentation.tasks.find((t) => t.id === 'collect')!;
    expect(task.artifacts).toEqual(['data/clusters.json']);
  });

  it('attaches only the runs that belong to the task', () => {
    const review = ws().presentation.tasks.find((t) => t.id === 'review')!;
    const collect = ws().presentation.tasks.find((t) => t.id === 'collect')!;
    expect(review.runs.map((r) => r.id)).toEqual(['run-1']);
    expect(collect.runs.map((r) => r.id)).toEqual(['run-2']);
  });

  it('attaches declared actions plus any action targeting the task', () => {
    const p = ws().presentation;
    const review = p.tasks.find((t) => t.id === 'review')!;
    // `review` declares approve/reject; `publish` reaches it by taskId. Union,
    // for the same reason artifacts union: an action must never be unreachable.
    expect(review.actions.map((a) => a.id)).toEqual(['approve', 'reject', 'publish']);
  });

  it('never attaches an action that belongs to a different task', () => {
    const p = ws().presentation;
    expect(p.tasks.find((t) => t.id === 'collect')!.actions.map((a) => a.id)).toEqual(['run-again']);
    expect(p.tasks.find((t) => t.id === 'orphan')!.actions).toEqual([]);
  });
});

describe('runs', () => {
  it('exposes each run once, at the top level and on its task', () => {
    const p = ws().presentation;
    expect(p.runs.map((r) => r.id)).toEqual(['run-1', 'run-2']);
    expect(p.tasks.find((t) => t.id === 'review')!.runs[0]!.id).toBe('run-1');
  });

  it('keeps the steps, in order, with their statuses', () => {
    const run = ws().presentation.runs.find((r) => r.id === 'run-1')!;
    expect(run.steps?.map((s) => s.status)).toEqual(['succeeded', 'succeeded', 'pending']);
    expect(run.steps?.[2]!.detail).toBe('needs a person');
  });

  it('carries the declared duration and summary', () => {
    const run = ws().presentation.runs.find((r) => r.id === 'run-1')!;
    expect(run.durationMs).toBe(240_000);
    expect(run.summary).toBe('Clustered 34 items into 3 drafts.');
  });

  it('is not marked simulated — it came from the producer, not the stub', () => {
    const run = ws().presentation.runs.find((r) => r.id === 'run-1')!;
    expect(run.simulated).toBeFalsy();
  });

  it('tolerates a run with no steps at all', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, runs: [{ id: 'bare' }] }),
      'README.md': '# Hi\n',
    });
    const run = new Workspace(root).presentation.runs[0]!;
    expect(run.id).toBe('bare');
    expect(run.steps ?? []).toEqual([]);
  });
});

describe('actions as declared data', () => {
  it('lists every declared action with its task', () => {
    const p = ws().presentation;
    expect(p.actions.map((a) => a.id)).toEqual(['approve', 'reject', 'publish', 'run-again']);
    expect(p.actions.find((a) => a.id === 'publish')!.taskId).toBe('review');
  });

  it('demands confirmation for an action that leaves A2H, without being asked', () => {
    const publish = ws().presentation.actions.find((a) => a.id === 'publish')!;
    expect(publish.sideEffect).toBe('external');
    expect(publish.confirm).toBe(true);
  });

  it('does not demand confirmation for a state-only action', () => {
    const approve = ws().presentation.actions.find((a) => a.id === 'approve')!;
    expect(approve.sideEffect).toBe('state');
    expect(approve.confirm).toBe(false);
  });

  it('defaults an unspecified side effect to the conservative middle', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, actions: [{ id: 'a', label: 'A' }] }),
      'README.md': '# Hi\n',
    });
    expect(new Workspace(root).presentation.actions[0]!.sideEffect).toBe('state');
  });

  it('skips an action missing an id or a label, and says why', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, actions: [{ id: 'no-label' }, { label: 'No id' }] }),
      'README.md': '# Hi\n',
    });
    const p = new Workspace(root).presentation;
    expect(p.actions).toEqual([]);
    expect(p.warnings.join(' ')).toMatch(/needs both "id" and "label"/);
  });

  it('keeps a disabled action visible but disabled', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, actions: [{ id: 'a', label: 'A', enabled: false }] }),
      'README.md': '# Hi\n',
    });
    const a = new Workspace(root).presentation.actions[0]!;
    expect(a.enabled).toBe(false);
  });

  it('keeps the declared inputs on the action', () => {
    const root = makeWorkspace({
      ...manifest({
        a2h: 1,
        actions: [
          {
            id: 'a',
            label: 'A',
            params: [
              { name: 'reason', label: 'Why', type: 'textarea', required: true },
              { name: 'mode', label: 'Mode', type: 'select', options: ['x', 'y'] },
            ],
          },
        ],
      }),
      'README.md': '# Hi\n',
    });
    const a = new Workspace(root).presentation.actions[0]!;
    expect(a.params).toHaveLength(2);
    expect(a.params![0]).toMatchObject({ name: 'reason', type: 'textarea', required: true });
    expect(a.params![1]!.options).toEqual(['x', 'y']);
  });
});

describe('the task surface is invisible when nothing declares one', () => {
  it('does not invent tasks, runs or actions for a plain repo', () => {
    const ws2 = new Workspace(makeWorkspace({ 'README.md': '# Hi\n', 'src/a.ts': 'export {};\n' }));
    const p = ws2.presentation;
    expect(p.tasks).toEqual([]);
    expect(p.runs).toEqual([]);
    expect(p.actions).toEqual([]);
    expect(p.simulatedActions).toBe(false);
  });
});
