import { describe, it, expect } from 'vitest';
import { Workspace } from '../src/server/workspace';
import { ActionEngine } from '../src/actions/engine';
import { createDefaultRegistry } from '../src/providers/registry';
import type { ActionExecutor } from '../src/providers/types';
import { createRegistry, markSimulated } from '../src/providers/types';
import { makeWorkspace, manifest } from './helpers/ws';

// The action engine is the only place a browser can cause an effect, so it is
// the place the security boundary is enforced. These tests are written from the
// attacker's side: what can a hostile page ask for, and what happens?

const DECLARED = [
  {
    id: 'approve',
    label: 'Approve',
    kind: 'approve',
    taskId: 't1',
    sideEffect: 'state' as const,
    confirm: false,
    enabled: true,
    simulated: true,
  },
  {
    id: 'dangerous',
    label: 'Publish',
    kind: 'publish',
    taskId: 't1',
    sideEffect: 'external' as const,
    confirm: true,
    enabled: true,
    simulated: true,
  },
  {
    id: 'off',
    label: 'Disabled action',
    kind: 'run',
    taskId: 't1',
    sideEffect: 'state' as const,
    confirm: false,
    enabled: false,
    simulated: true,
  },
  {
    id: 'needs-input',
    label: 'Discard',
    kind: 'discard',
    taskId: 't1',
    sideEffect: 'state' as const,
    confirm: false,
    enabled: true,
    simulated: true,
    params: [{ name: 'reason', label: 'Why', type: 'text' as const, required: true }],
  },
];

function engineWithNoExecutor() {
  return new ActionEngine({ rootDir: '/tmp', registry: createRegistry([]) });
}

function engine() {
  return new ActionEngine({ rootDir: '/tmp', registry: createDefaultRegistry() });
}

describe('the declared-action allowlist', () => {
  it('refuses an action the workspace never declared', async () => {
    const result = await engine().execute({ id: 'rm-rf', params: {} }, DECLARED as never);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('unknown_action');
  });

  it('refuses an action id that merely looks like a declared one', async () => {
    const result = await engine().execute({ id: 'approve ', params: {} }, DECLARED as never);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('unknown_action');
  });

  it('refuses everything when nothing is declared', async () => {
    const result = await engine().execute({ id: 'approve' }, []);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('unknown_action');
  });

  it('refuses a disabled action', async () => {
    const result = await engine().execute({ id: 'off' }, DECLARED as never);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('disabled');
  });

  it('records the refusal in the audit trail', async () => {
    const e = engine();
    await e.execute({ id: 'not-real' }, DECLARED as never);
    const audit = e.getAuditTrail();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actionId: 'not-real', ok: false });
  });
});

describe('the confirmation boundary', () => {
  it('will not run a side-effecting action without an explicit confirmation', async () => {
    const e = engine();
    const result = await e.execute({ id: 'dangerous' }, DECLARED as never);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('confirmation_required');
    // Nothing happened: no run was produced.
    expect(e.getRuntimeRuns()).toEqual([]);
  });

  it('treats a truthy-but-not-true confirmation as no confirmation', async () => {
    const e = engine();
    const result = await e.execute(
      { id: 'dangerous', confirm: 'yes' as unknown as boolean },
      DECLARED as never,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('confirmation_required');
  });

  it('runs the action once confirmation is explicit', async () => {
    const e = engine();
    const result = await e.execute({ id: 'dangerous', confirm: true }, DECLARED as never);

    expect(result.ok).toBe(true);
    expect(result.simulated).toBe(true);
    expect(e.getRuntimeRuns()).toHaveLength(1);
  });

  it('does not demand confirmation for an action that declared none', async () => {
    const result = await engine().execute({ id: 'approve' }, DECLARED as never);
    expect(result.ok).toBe(true);
  });
});

describe('required inputs', () => {
  it('refuses when a required input is missing', async () => {
    const result = await engine().execute({ id: 'needs-input', params: {} }, DECLARED as never);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('missing_params');
  });

  it('refuses when a required input is only whitespace', async () => {
    const result = await engine().execute(
      { id: 'needs-input', params: { reason: '   ' } },
      DECLARED as never,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('missing_params');
  });

  it('accepts once the input is supplied', async () => {
    const result = await engine().execute(
      { id: 'needs-input', params: { reason: 'stale' } },
      DECLARED as never,
    );
    expect(result.ok).toBe(true);
  });
});

describe('browser input is untrusted data, never a command', () => {
  it('caps a single parameter at 2000 characters', async () => {
    const e = engine();
    await e.execute(
      { id: 'needs-input', params: { reason: 'x'.repeat(50_000) } },
      DECLARED as never,
    );
    const run = e.getRuntimeRuns()[0]!;
    // The mock echoes the parameter back into the run summary; the flood is gone.
    expect(run.summary!.length).toBeLessThan(2500);
  });

  it('drops values that are not strings, numbers or booleans', async () => {
    const e = engine();
    await e.execute(
      {
        id: 'needs-input',
        params: {
          reason: 'ok',
          evil: { $gt: '' },
          list: ['a', 'b'],
        } as never,
      },
      DECLARED as never,
    );
    const run = e.getRuntimeRuns()[0]!;
    expect(run.summary).toContain('reason=ok');
    expect(run.summary).not.toContain('evil');
    expect(run.summary).not.toContain('list');
  });

  it('ignores extra parameters the action never asked for', async () => {
    const e = engine();
    await e.execute(
      { id: 'approve', params: { shell: 'rm -rf /', cwd: '/etc' } },
      DECLARED as never,
    );
    // The action ran, and what ran was `approve` — not the string it was given.
    const audit = e.getAuditTrail();
    expect(audit[0]!.actionId).toBe('approve');
    expect(audit[0]!.kind).toBe('approve');
  });

  it('survives a params payload that is not an object at all', async () => {
    const result = await engine().execute(
      { id: 'approve', params: 'not-an-object' as never },
      DECLARED as never,
    );
    expect(result.ok).toBe(true);
  });
});

describe('provider seams', () => {
  it('reports no_executor when nothing can handle the action', async () => {
    const result = await engineWithNoExecutor().execute({ id: 'approve' }, DECLARED as never);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('no_executor');
  });

  it('reports executor_failed when an executor throws, and still audits it', async () => {
    const broken: ActionExecutor = {
      id: 'broken',
      description: 'always throws',
      handles: () => true,
      execute: () => {
        throw new Error('boom');
      },
    };
    const e = new ActionEngine({ rootDir: '/tmp', registry: createRegistry([broken]) });
    const result = await e.execute({ id: 'approve' }, DECLARED as never);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('executor_failed');
    // One attempt, one audit line — and it names the executor that failed.
    expect(e.getAuditTrail()).toHaveLength(1);
    expect(e.getAuditTrail()[0]).toMatchObject({ ok: false, executor: 'broken' });
  });

  it('reports failure when an executor rejects asynchronously', async () => {
    const broken = markSimulated({
      id: 'async-broken',
      description: 'rejects',
      handles: () => true,
      execute: async () => {
        throw new Error('nope');
      },
    });
    const e = new ActionEngine({ rootDir: '/tmp', registry: createRegistry([broken]) });
    const result = await e.execute({ id: 'approve' }, DECLARED as never);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('executor_failed');
  });

  it('flags the built-in executor as a simulation', () => {
    expect(createDefaultRegistry().simulated).toBe(true);
  });
});

describe('an action changes what the presentation shows', () => {
  const WORKSPACE = {
    a2h: 1,
    tasks: [{ id: 't1', title: 'Review the draft', status: 'pending', actions: ['approve'] }],
    actions: [
      {
        id: 'approve',
        label: 'Approve',
        kind: 'approve',
        taskId: 't1',
        sideEffect: 'state',
        confirm: false,
      },
    ],
    items: [{ path: 'README.md', taskId: 't1' }],
  };

  it('starts from the declared state', () => {
    const ws = new Workspace(makeWorkspace({ ...manifest(WORKSPACE), 'README.md': '# Hi\n' }));
    const task = ws.presentation.tasks.find((t) => t.id === 't1')!;
    expect(task.status).toBe('pending');
    expect(task.runs).toEqual([]);
  });

  it('overlays the new status and the new run once executed', async () => {
    const ws = new Workspace(makeWorkspace({ ...manifest(WORKSPACE), 'README.md': '# Hi\n' }));

    const result = await ws.engine.execute({ id: 'approve' }, ws.declaredActions());
    expect(result.ok).toBe(true);

    // The presentation is recomputed on read, so the change is visible at once.
    const task = ws.presentation.tasks.find((t) => t.id === 't1')!;
    expect(task.status).toBe('succeeded');
    expect(task.runs).toHaveLength(1);
    expect(task.runs[0]!.simulated).toBe(true);
    expect(ws.presentation.runs.map((r) => r.id)).toContain(result.run!.id);
  });

  it('surfaces the audit trail on the presentation', async () => {
    const ws = new Workspace(makeWorkspace({ ...manifest(WORKSPACE), 'README.md': '# Hi\n' }));
    expect(ws.presentation.audit).toEqual([]);

    await ws.engine.execute({ id: 'approve' }, ws.declaredActions());
    expect(ws.presentation.audit).toHaveLength(1);
    expect(ws.presentation.audit[0]).toMatchObject({ actionId: 'approve', ok: true, simulated: true });
  });

  it('says plainly that the workspace is running on a stub', () => {
    const ws = new Workspace(makeWorkspace({ ...manifest(WORKSPACE), 'README.md': '# Hi\n' }));
    expect(ws.presentation.simulatedActions).toBe(true);
    expect(ws.presentation.actions.every((a) => a.simulated)).toBe(true);
  });

  it('does not rescan the disk when only runtime state changed', async () => {
    const root = makeWorkspace({ ...manifest(WORKSPACE), 'README.md': '# Hi\n' });
    const ws = new Workspace(root);
    const before = ws.version;

    await ws.engine.execute({ id: 'approve' }, ws.declaredActions());
    expect(ws.version).toBe(before);
  });
});
