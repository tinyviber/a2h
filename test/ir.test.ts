import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { scanWorkspace } from '../src/scanner/scan';
import { buildSemanticIR, hash } from '../src/ir/build';
import { present } from '../src/presentation/present';

const FIX = (name: string) => resolve(__dirname, 'fixtures', name);

function irOf(name: string) {
  return buildSemanticIR(scanWorkspace({ rootDir: FIX(name) }));
}

describe('semantic IR', () => {
  it('puts README in the overview section', () => {
    const ir = irOf('clean');
    const overview = ir.root.children.find((s) => s.id === 'overview');
    expect(overview).toBeDefined();
    const readme = overview!.children.find((a) => a.kind === 'readme');
    expect(readme).toBeDefined();
    expect(readme!.path).toBe('README.md');
  });

  it('classifies outputs/report.md as a report', () => {
    const ir = irOf('clean');
    const reports = ir.root.children.find((s) => s.id === 'reports');
    const report = reports?.children.find((a) => a.path === 'outputs/report.md');
    expect(report?.kind).toBe('report');
  });

  it('sections exclude empty categories', () => {
    const ir = irOf('clean');
    const ids = ir.root.children.map((s) => s.id);
    expect(ids).toContain('overview');
    expect(ids).toContain('reports');
    expect(ids).toContain('visuals');
    expect(ids).toContain('logs');
    // clean has no diff/json/code sections
    expect(ids).not.toContain('changes');
  });

  it('sorts artifacts by priority within a section (final > tmp)', () => {
    const ir = irOf('messy');
    const reports = ir.root.children.find((s) => s.id === 'reports')!;
    const order = reports.children.map((a) => a.path);
    expect(order).toContain('final.md');
    expect(order.indexOf('tmp/x.md')).toBeGreaterThan(order.indexOf('final.md'));
  });

  it('assigns a higher priority to report vs plain markdown', () => {
    const ir = irOf('mixed');
    const reports = ir.root.children.find((s) => s.id === 'reports')!;
    const report = reports.children.find((a) => a.path === 'report.md');
    expect(report?.kind).toBe('report');
  });

  it('produces a stable workspace id', () => {
    const a = irOf('clean');
    const b = irOf('clean');
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(hash(resolve(__dirname, 'fixtures', 'clean')));
  });
});

describe('presentation', () => {
  it('computes highlights excluding the readme', () => {
    const ir = irOf('mixed');
    const p = present(ir);
    expect(p.highlights.every((h) => h.kind !== 'readme')).toBe(true);
    expect(p.highlights.length).toBeLessThanOrEqual(5);
  });

  it('keeps the section order stable', () => {
    const ir = irOf('mixed');
    const p = present(ir);
    const kinds = p.sections.map((s) => s.kind);
    expect(kinds).toEqual(kinds.slice().sort((a, b) => {
      const order = ['overview', 'reports', 'changes', 'visuals', 'logs', 'data', 'code', 'other'];
      return order.indexOf(a) - order.indexOf(b);
    }));
  });

  it('carries stats through to the presentation', () => {
    const ir = irOf('mixed');
    const p = present(ir);
    expect(p.stats.files).toBe(ir.stats.files);
  });
});
