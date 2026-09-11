import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Workspace } from '../src/server/workspace';
import { ActionEngine } from '../src/actions/engine';
import { createDefaultRegistry } from '../src/providers/registry';
import { decisionFileName, writeDecisionRecord } from '../src/actions/decisions';
import type { DecisionRecord } from '../src/types';
import { makeWorkspace, manifest, symlink } from './helpers/ws';

// The durable half of the action trail.
//
// Two things are being held here at once, and both matter:
//   * a human's decision survives the process that observed it;
//   * a file in `.a2h/decisions/` is never an input. It cannot grant an action
//     authority or waive a confirmation, and it cannot be used to escape the
//     workspace when A2H writes or reads it.

const AT = '2026-09-10T09:41:00.000Z';

const MANIFEST = {
  a2h: 1,
  name: 'Decision log',
  tasks: [{ id: 'review', title: 'Review', status: 'blocked', actions: ['approve'] }],
  actions: [
    {
      id: 'approve',
      label: 'Approve',
      kind: 'approve',
      taskId: 'review',
      sideEffect: 'external',
      params: [
        { name: 'draft', label: 'Draft', type: 'text', required: true },
        { name: 'note', label: 'Note', type: 'text' },
      ],
    },
  ],
  items: [{ path: 'README.md', role: 'readme', taskId: 'review' }],
};

const FIXED = () => new Date(AT);

function decisionsDir(root: string): string {
  return join(root, '.a2h', 'decisions');
}

function decisionFiles(root: string): string[] {
  const dir = decisionsDir(root);
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function readOnly(root: string): DecisionRecord {
  const names = decisionFiles(root);
  expect(names).toHaveLength(1);
  return JSON.parse(readFileSync(join(decisionsDir(root), names[0]!), 'utf8')) as DecisionRecord;
}

function workspace(): Workspace {
  return new Workspace({
    rootDir: makeWorkspace({ ...manifest(MANIFEST), 'README.md': '# Hi\n' }),
    now: FIXED,
  });
}

describe('the engine writes one durable record per attempt', () => {
  it('records a successful attempt, with the params the executor received', async () => {
    const ws = workspace();
    const result = await ws.engine.execute(
      { id: 'approve', params: { draft: 'a.md', note: 'looks right' }, confirm: true },
      ws.declaredActions(),
    );
    expect(result.ok).toBe(true);

    const record = readOnly(ws.rootDir);
    expect(record.a2h).toBe(1);
    expect(record.at).toBe(AT);
    expect(record.actionId).toBe('approve');
    expect(record.kind).toBe('approve');
    // The executor's policy is authoritative, so an external action is filed
    // as external even though the mock's own effect is only state.
    expect(record.sideEffect).toBe('external');
    expect(record.ok).toBe(true);
    expect(record.simulated).toBe(true);
    expect(record.executor).toBe('mock');
    expect(record.taskId).toBe('review');
    expect(record.params).toEqual({ draft: 'a.md', note: 'looks right' });
  });

  it('records a refused attempt too — exactly one record, not zero', async () => {
    const ws = workspace();
    const result = await ws.engine.execute(
      { id: 'approve', params: { draft: 'a.md' }, confirm: false },
      ws.declaredActions(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('confirmation_required');

    const record = readOnly(ws.rootDir);
    expect(record.ok).toBe(false);
    expect(record.actionId).toBe('approve');
  });

  it('records an attempt the workspace never declared', async () => {
    const ws = workspace();
    await ws.engine.execute({ id: 'ghost', params: {} }, ws.declaredActions());

    const record = readOnly(ws.rootDir);
    expect(record.actionId).toBe('ghost');
    expect(record.ok).toBe(false);
    expect(record.executor).toBe('none');
  });

  it('does not collide when two attempts share a millisecond', async () => {
    const ws = workspace();
    const declared = ws.declaredActions();
    await ws.engine.execute({ id: 'approve', params: { draft: 'a.md' }, confirm: true }, declared);
    await ws.engine.execute({ id: 'approve', params: { draft: 'b.md' }, confirm: true }, declared);

    const names = decisionFiles(ws.rootDir);
    expect(names).toHaveLength(2);
    expect(names).toEqual([decisionFileName(AT, 'approve', 1), decisionFileName(AT, 'approve')]);
  });

  it('persists no key the action did not declare', async () => {
    const ws = workspace();
    await ws.engine.execute(
      {
        id: 'approve',
        params: { draft: 'a.md', shell: 'rm -rf /', cwd: '/etc', note: 'ok' },
        confirm: true,
      },
      ws.declaredActions(),
    );

    const path = join(decisionsDir(ws.rootDir), decisionFiles(ws.rootDir)[0]!);
    const raw = readFileSync(path, 'utf8');
    const record = JSON.parse(raw) as DecisionRecord;

    // The filter is the same one the executor saw, so the disk cannot hold a
    // value the executor was never allowed to read.
    expect(Object.keys(record.params ?? {}).sort()).toEqual(['draft', 'note']);
    expect(raw).not.toContain('rm -rf');
    expect(raw).not.toContain('shell');
    expect(raw).not.toContain('/etc');
  });
});

describe('the writer refuses to leave the workspace', () => {
  const RECORD: DecisionRecord = {
    at: AT,
    actionId: 'approve',
    kind: 'approve',
    sideEffect: 'external',
    ok: true,
    simulated: true,
    message: 'Approved.',
    executor: 'mock',
  };

  it('refuses when `.a2h` is a symlink out of the tree', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    const outside = makeWorkspace({});
    symlink(root, '.a2h', outside);

    const result = writeDecisionRecord(root, RECORD);
    expect(result.written).toBe(false);
    expect(readdirSync(outside)).toEqual([]);
  });

  it('refuses when the decisions directory is a symlink', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    const outside = makeWorkspace({});
    // The parent must exist as a real directory for this to be the interesting
    // case: it is `.a2h/decisions` itself that points away.
    symlink(root, '.a2h/decisions', outside);

    const result = writeDecisionRecord(root, RECORD);
    expect(result.written).toBe(false);
    expect(readdirSync(outside)).toEqual([]);
  });

  it('refuses to write through a link sitting where the record belongs', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    const outside = makeWorkspace({ 'kept.txt': 'untouched\n' });
    const name = decisionFileName(AT, 'approve');
    symlink(root, `.a2h/decisions/${name}`, join(outside, 'kept.txt'));

    const result = writeDecisionRecord(root, RECORD);
    expect(result.written).toBe(false);
    expect(readFileSync(join(outside, 'kept.txt'), 'utf8')).toBe('untouched\n');
  });

  it('refuses a record larger than the cap', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    const result = writeDecisionRecord(root, { ...RECORD, message: 'x'.repeat(70 * 1024) });
    expect(result.written).toBe(false);
    expect(decisionFiles(root)).toEqual([]);
  });

  it('still lets the action succeed when the record cannot be filed', async () => {
    const root = makeWorkspace({ ...manifest(MANIFEST), 'README.md': '# Hi\n' });
    const outside = makeWorkspace({});
    symlink(root, '.a2h/decisions', outside);

    const ws = new Workspace({ rootDir: root, now: FIXED });
    const result = await ws.engine.execute(
      { id: 'approve', params: { draft: 'a.md' }, confirm: true },
      ws.declaredActions(),
    );

    // Filing a record is bookkeeping. An action that really ran must not be
    // reported as failed because its note could not be written.
    expect(result.ok).toBe(true);
    expect(readdirSync(outside)).toEqual([]);
  });
});

describe('the writer is the authority for the protocol version', () => {
  // A decision record's `a2h` describes the file format. A caller — a stale
  // wrapper, a replayed record, a hand-built object — must not be able to
  // relabel a file the writer is about to create, or the audit trail stops
  // meaning one thing.
  const RECORD: DecisionRecord = {
    at: AT,
    actionId: 'approve',
    kind: 'approve',
    sideEffect: 'external',
    ok: true,
    simulated: true,
    message: 'Approved.',
    executor: 'mock',
    params: { draft: 'a.md' },
  };

  it('forces `a2h: 1` over whatever the caller passed, and keeps every other field', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    const result = writeDecisionRecord(root, { ...RECORD, a2h: 999 });
    expect(result.written).toBe(true);

    const onDisk = JSON.parse(
      readFileSync(join(decisionsDir(root), decisionFiles(root)[0]!), 'utf8'),
    ) as DecisionRecord;

    expect(onDisk.a2h).toBe(1);
    expect(onDisk.at).toBe(AT);
    expect(onDisk.actionId).toBe('approve');
    expect(onDisk.kind).toBe('approve');
    expect(onDisk.sideEffect).toBe('external');
    expect(onDisk.ok).toBe(true);
    expect(onDisk.simulated).toBe(true);
    expect(onDisk.message).toBe('Approved.');
    expect(onDisk.executor).toBe('mock');
    expect(onDisk.params).toEqual({ draft: 'a.md' });
  });

  it('names the file from the record, not from the version it was handed', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    writeDecisionRecord(root, { ...RECORD, a2h: 7 });
    expect(decisionFiles(root)).toEqual([decisionFileName(AT, 'approve')]);
  });

  it('reads back through the loader as version 1', () => {
    const root = makeWorkspace({ ...manifest(MANIFEST), 'README.md': '# Hi\n' });
    writeDecisionRecord(root, { ...RECORD, a2h: 999 });

    const restarted = new Workspace({ rootDir: root, now: FIXED });
    const entry = restarted.presentation.audit.find((e) => e.actionId === 'approve');

    expect(entry).toBeDefined();
    expect(entry!.a2h).toBe(1);
    expect(entry!.params).toEqual({ draft: 'a.md' });
  });
});

describe('a decision outlives the process that made it', () => {
  it('reloads into the audit trail of a fresh workspace', async () => {
    const root = makeWorkspace({ ...manifest(MANIFEST), 'README.md': '# Hi\n' });
    const first = new Workspace({ rootDir: root, now: FIXED });
    await first.engine.execute(
      { id: 'approve', params: { draft: 'a.md', note: 'ship it' }, confirm: true },
      first.declaredActions(),
    );

    // A second Workspace is what a restarted viewer looks like: no session.
    const restarted = new Workspace(root);
    const entry = restarted.presentation.audit.find((e) => e.actionId === 'approve');

    expect(entry).toBeDefined();
    expect(entry!.ok).toBe(true);
    expect(entry!.simulated).toBe(true);
    expect(entry!.executor).toBe('mock');
    expect(entry!.taskId).toBe('review');
    expect(entry!.params).toEqual({ draft: 'a.md', note: 'ship it' });
  });

  it('does not double-list the same attempt after a rescan', async () => {
    const root = makeWorkspace({ ...manifest(MANIFEST), 'README.md': '# Hi\n' });
    const ws = new Workspace({ rootDir: root, now: FIXED });
    await ws.engine.execute(
      { id: 'approve', params: { draft: 'a.md' }, confirm: true },
      ws.declaredActions(),
    );

    ws.rescan();

    // The session entry and its own durable record describe one attempt.
    expect(ws.presentation.audit.filter((e) => e.actionId === 'approve')).toHaveLength(1);
  });

  it('reports the newest records first, and only the newest window', () => {
    const files: Record<string, string> = { 'README.md': '# Hi\n' };
    const total = 205;
    for (let i = 0; i < total; i++) {
      const name = `d-${String(i).padStart(3, '0')}.json`;
      files[`.a2h/decisions/${name}`] = JSON.stringify({
        at: '2026-01-01T00:00:00.000Z',
        actionId: `a${i}`,
        kind: 'approve',
        sideEffect: 'state',
        ok: true,
        simulated: true,
        message: 'm',
        executor: 'mock',
      });
    }
    const ws = new Workspace(makeWorkspace(files));
    const ids = ws.presentation.audit.map((e) => e.actionId);

    expect(ids).toHaveLength(200);
    expect(ids).toContain(`a${total - 1}`);
    expect(ids).not.toContain('a0');
    expect(ws.presentation.warnings.join(' ')).toMatch(/newest/);
  });
});

describe('a decision file is an audit trail, not an input', () => {
  it('cannot lower an action\'s severity or claim a real effect', () => {
    const root = makeWorkspace({
      ...manifest({
        a2h: 1,
        tasks: [{ id: 'review', actions: ['approve'] }],
        actions: [
          { id: 'approve', label: 'Approve', kind: 'approve', taskId: 'review', sideEffect: 'external' },
        ],
      }),
      // A record that claims the action was already approved, for real.
      '.a2h/decisions/2026-01-01T00-00-00-000Z-approve.json': JSON.stringify({
        a2h: 1,
        at: '2026-01-01T00:00:00.000Z',
        actionId: 'approve',
        kind: 'approve',
        sideEffect: 'none',
        ok: true,
        simulated: false,
        message: 'approved outside A2H',
        executor: 'real',
      }),
      'README.md': '# Hi\n',
    });
    const ws = new Workspace(root);
    const action = ws.presentation.actions.find((a) => a.id === 'approve')!;

    // The manifest's own claim plus the executor's policy still decide.
    expect(action.sideEffect).toBe('external');
    expect(action.confirm).toBe(true);
    expect(action.simulated).toBe(true);
  });

  it('is not counted as declared semantics', () => {
    const ws = new Workspace(
      makeWorkspace({
        '.a2h/decisions/2026-01-01T00-00-00-000Z-approve.json': JSON.stringify({
          at: '2026-01-01T00:00:00.000Z',
          actionId: 'approve',
        }),
        'README.md': '# Hi\n',
      }),
    );
    // A decision does not make a workspace "explicit"; it is a record, not a
    // manifest, and the zero-config reading still applies.
    expect(ws.presentation.semantics).toBe('inferred');
  });

  it('degrades to a warning rather than a crash on a broken record', () => {
    const root = makeWorkspace({
      '.a2h/decisions/2026-01-01T00-00-00-000Z-broken.json': '{ not json',
      'README.md': '# Hi\n',
    });
    const ws = new Workspace(root);

    expect(ws.presentation.audit).toEqual([]);
    expect(ws.presentation.warnings.join(' ')).toMatch(/could not parse/);
    // Refusals are reported, never silently dropped, because they are what
    // `a2h validate` escalates.
    expect(ws.presentation.warnings.join(' ')).toContain('.a2h/decisions/2026-01-01T00-00-00-000Z-broken.json');
  });
});

describe('the engine only touches the workspace root it was given', () => {
  it('files nothing outside it', async () => {
    const outside = makeWorkspace({});
    const engine = new ActionEngine({ rootDir: outside, registry: createDefaultRegistry(), now: FIXED });
    await engine.execute({ id: 'ghost', params: {} }, []);

    // `/tmp` and friends are not workspaces. Everything lands under the root
    // the caller named, and nowhere else.
    expect(decisionFiles(outside)).toHaveLength(1);
  });
});
