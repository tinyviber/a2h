import { describe, it, expect, vi, afterEach } from 'vitest';
import { printValidateReport, validateWorkspace } from '../src/cli/validate';
import { makeWorkspace, manifest, symlink } from './helpers/ws';

// `a2h validate` is what a producer runs before a human ever opens the page.
// Its whole value is the line it draws between the two severities:
//
//   error   — the workspace claims something broken. Presenting it would put a
//             false statement in front of a human. Exit 1.
//   warning — renderable but thinner than it could be. Exit 0.
//
// If that line drifts, the command becomes either noise or a rubber stamp, so
// both sides of it are pinned here.

const README = '# Hi\n';

describe('validate accepts what it can render', () => {
  it('passes a workspace with no manifest, as a warning', () => {
    const report = validateWorkspace(makeWorkspace({ 'README.md': README }));

    expect(report.errors).toEqual([]);
    expect(report.manifestPath).toBeUndefined();
    // Zero-config is a supported mode, not a defect.
    expect(report.warnings.join(' ')).toMatch(/no \.a2h\/manifest\.json/);
  });

  it('passes the two shipped examples', () => {
    for (const name of ['radar', 'coding-task']) {
      const report = validateWorkspace(`examples/${name}`);
      expect(report.errors, `${name} should have no errors`).toEqual([]);
      expect(report.manifestPath).toBe('.a2h/manifest.json');
    }
  });

  it('treats a producer-defined role as a warning, never an error', () => {
    const report = validateWorkspace(
      makeWorkspace({
        ...manifest({ a2h: 1, items: [{ path: 'README.md', role: 'signal' }] }),
        'README.md': README,
      }),
    );

    expect(report.errors).toEqual([]);
    expect(report.warnings.join(' ')).toMatch(/unknown role/);
    expect(report.warnings.join(' ')).toContain('"signal"');
  });

  it('warns about an action no task points at', () => {
    const report = validateWorkspace(
      makeWorkspace({
        ...manifest({
          a2h: 1,
          tasks: [{ id: 't1' }],
          actions: [{ id: 'orphan', label: 'Orphan' }],
        }),
        'README.md': README,
      }),
    );

    expect(report.errors).toEqual([]);
    expect(report.warnings.join(' ')).toMatch(/no task points at it/);
  });

  it('warns when a manifest declares no tasks', () => {
    const report = validateWorkspace(
      makeWorkspace({
        ...manifest({ a2h: 1, tasks: [], items: [{ path: 'README.md' }] }),
        'README.md': README,
      }),
    );

    expect(report.errors).toEqual([]);
    expect(report.warnings.join(' ')).toMatch(/declares no tasks/);
  });
});

describe('validate rejects what would mislead a human', () => {
  it('rejects a manifest it cannot parse', () => {
    const report = validateWorkspace(
      makeWorkspace({ '.a2h/manifest.json': '{ this is not json', 'README.md': README }),
    );

    expect(report.errors.join(' ')).toMatch(/could not parse \.a2h\/manifest\.json/);
    // The summary must not call a broken manifest "zero-config".
    expect(report.manifestUnusable).toBe(true);
    expect(report.manifestPath).toBeUndefined();
  });

  it('rejects a manifest that is a symlink out of the tree', () => {
    const root = makeWorkspace({ 'README.md': README });
    const outside = makeWorkspace({ 'manifest.json': '{}' });
    symlink(root, '.a2h/manifest.json', `${outside}/manifest.json`);

    const report = validateWorkspace(root);
    expect(report.errors.join(' ')).toMatch(/symlink/);
  });

  it('rejects an item pointing at a path that does not exist', () => {
    const report = validateWorkspace(
      makeWorkspace({
        ...manifest({ a2h: 1, items: [{ path: 'README.md' }, { path: 'outputs/missing.md' }] }),
        'README.md': README,
      }),
    );

    expect(report.errors.join(' ')).toMatch(/item "outputs\/missing\.md"/);
  });

  it('rejects a task pointing at an unknown action id', () => {
    const report = validateWorkspace(
      makeWorkspace({
        ...manifest({ a2h: 1, tasks: [{ id: 'review', actions: ['approve', 'typo'] }] }),
        'README.md': README,
      }),
    );

    expect(report.errors.join(' ')).toMatch(/task "review" references unknown action "typo"/);
  });

  it('rejects an action owned by a task that is not declared', () => {
    const report = validateWorkspace(
      makeWorkspace({
        ...manifest({
          a2h: 1,
          tasks: [{ id: 'review' }],
          actions: [{ id: 'approve', label: 'Approve', taskId: 'revieww' }],
        }),
        'README.md': README,
      }),
    );

    expect(report.errors.join(' ')).toMatch(/action "approve"/);
    expect(report.errors.join(' ')).toMatch(/revieww/);
  });

  it('rejects a decision file too large to read', () => {
    const report = validateWorkspace(
      makeWorkspace({
        '.a2h/decisions/2026-01-01T00-00-00-000Z-big.json': JSON.stringify({
          at: '2026-01-01T00:00:00.000Z',
          actionId: 'approve',
          message: 'x'.repeat(70 * 1024),
        }),
        'README.md': README,
      }),
    );

    expect(report.errors.join(' ')).toMatch(/too large/);
  });

  it('rejects a decision file that is a symlink', () => {
    const root = makeWorkspace({ 'README.md': README });
    const outside = makeWorkspace({ 'kept.json': '{}' });
    symlink(root, '.a2h/decisions/2026-01-01T00-00-00-000Z-x.json', `${outside}/kept.json`);

    const report = validateWorkspace(root);
    expect(report.errors.join(' ')).toMatch(/symlink/);
  });
});

describe('the exit code is the contract', () => {
  afterEach(() => vi.restoreAllMocks());

  function run(report: ReturnType<typeof validateWorkspace>): number {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    return printValidateReport(report);
  }

  it('is 0 for a workspace with warnings but no errors', () => {
    const report = validateWorkspace(makeWorkspace({ 'README.md': README }));
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(run(report)).toBe(0);
  });

  it('is 1 for a workspace with errors', () => {
    const report = validateWorkspace(
      makeWorkspace({ '.a2h/manifest.json': 'not json at all', 'README.md': README }),
    );
    expect(run(report)).toBe(1);
  });

  it('lists every error rather than stopping at the first', () => {
    const report = validateWorkspace(
      makeWorkspace({
        ...manifest({
          a2h: 1,
          tasks: [{ id: 'review', actions: ['ghost'] }],
          items: [{ path: 'nope.md' }],
        }),
        'README.md': README,
      }),
    );

    expect(report.errors).toHaveLength(2);
    expect(run(report)).toBe(1);
  });
});
