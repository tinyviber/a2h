import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveRelPath, resolveRealPath, isWithin } from '../src/security/boundary';
import { normalizeRel } from '../src/util/path';

describe('normalizeRel', () => {
  it('normalizes dot segments', () => {
    expect(normalizeRel('a/./b')).toBe('a/b');
    expect(normalizeRel('a/../b')).toBe('b');
  });

  it('rejects escaping paths', () => {
    expect(normalizeRel('../etc')).toBeNull();
    expect(normalizeRel('a/../../etc')).toBeNull();
  });
});

describe('resolveRelPath', () => {
  const root = resolve('/tmp/a2h-root');

  it('resolves paths inside the root', () => {
    expect(resolveRelPath(root, 'outputs/a.md')).toBe(join(root, 'outputs/a.md'));
  });

  it('rejects traversal attempts', () => {
    expect(resolveRelPath(root, '../etc/passwd')).toBeNull();
    expect(resolveRelPath(root, '../../../../etc/passwd')).toBeNull();
    expect(resolveRelPath(root, '..')).toBeNull();
  });
});

describe('resolveRealPath (symlink escape)', () => {
  let dir: string;
  let outside: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'a2h-safe-'));
    outside = mkdtempSync(join(tmpdir(), 'a2h-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    symlinkSync(join(outside, 'secret.txt'), join(dir, 'link.txt'));
    writeFileSync(join(dir, 'real.txt'), 'real');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('rejects symlinks pointing outside the workspace', () => {
    expect(resolveRealPath(dir, 'link.txt')).toBeNull();
  });

  it('resolves real files inside the workspace', () => {
    expect(resolveRealPath(dir, 'real.txt')).toBe(join(dir, 'real.txt'));
  });
});

describe('isWithin', () => {
  it('detects containment', () => {
    expect(isWithin('/a/b', '/a/b/c')).toBe(true);
    expect(isWithin('/a/b', '/a/b')).toBe(true);
    expect(isWithin('/a/b', '/a/bc')).toBe(false);
  });
});
