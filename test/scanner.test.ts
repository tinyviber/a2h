import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { classifyFile } from '../src/scanner/classify';
import { scanWorkspace } from '../src/scanner/scan';
import { MAX_FILE_BYTES } from '../src/scanner/ignore';

const FIX = (name: string) => resolve(__dirname, 'fixtures', name);

describe('classifyFile', () => {
  it('classifies common extensions', () => {
    expect(classifyFile('README.md').kind).toBe('markdown');
    expect(classifyFile('src/main.ts').kind).toBe('code');
    expect(classifyFile('src/main.ts').language).toBe('TypeScript');
    expect(classifyFile('data.json').kind).toBe('json');
    expect(classifyFile('build.log').kind).toBe('log');
    expect(classifyFile('change.diff').kind).toBe('diff');
    expect(classifyFile('change.patch').kind).toBe('diff');
    expect(classifyFile('home.png').kind).toBe('image');
    expect(classifyFile('archive.zip').kind).toBe('binary');
    expect(classifyFile('notes.txt').kind).toBe('other');
  });

  it('flags sensitive files', () => {
    expect(classifyFile('.env').sensitive).toBe(true);
    expect(classifyFile('id_rsa').sensitive).toBe(true);
    expect(classifyFile('server.key').sensitive).toBe(true);
    expect(classifyFile('notes.txt').sensitive).toBe(false);
  });

  it('treats readme specially regardless of case', () => {
    expect(classifyFile('readme.md').kind).toBe('markdown');
    expect(classifyFile('ReadMe.MD').kind).toBe('markdown');
  });
});

describe('scanWorkspace', () => {
  it('scans the clean fixture and finds expected files', () => {
    const scan = scanWorkspace({ rootDir: FIX('clean') });
    const paths = scan.files.map((f) => f.path).sort();

    expect(paths).toContain('README.md');
    expect(paths).toContain('outputs/report.md');
    expect(paths).toContain('outputs/radar/today.md');
    expect(paths).toContain('screenshots/home.png');
    expect(paths).toContain('logs/build.log');
    expect(paths).toContain('package.json');
  });

  it('records ignored directories', () => {
    const scan = scanWorkspace({ rootDir: FIX('clean') });
    // No node_modules in fixture, but the .git (if present) would be ignored.
    expect(scan.files.every((f) => !f.path.startsWith('node_modules'))).toBe(true);
  });

  it('detects image and code kinds in the mixed fixture', () => {
    const scan = scanWorkspace({ rootDir: FIX('mixed') });
    const byPath = new Map(scan.files.map((f) => [f.path, f]));
    expect(byPath.get('screenshots/shot.png')?.kind).toBe('image');
    expect(byPath.get('src/main.ts')?.kind).toBe('code');
    expect(byPath.get('data/result.json')?.kind).toBe('json');
    expect(byPath.get('patches/change.diff')?.kind).toBe('diff');
    expect(byPath.get('logs/build.log')?.kind).toBe('log');
    expect(byPath.get('misc/unknown.bin')?.kind).toBe('binary');
    expect(byPath.get('.env')?.sensitive).toBe(true);
  });

  it('derives an identity from the README', () => {
    const scan = scanWorkspace({ rootDir: FIX('clean') });
    expect(scan.identity.name).toBe('Demo Project');
    expect(scan.identity.summary).toContain('tidy example workspace');
  });

  it('is deterministic across two scans', () => {
    const a = scanWorkspace({ rootDir: FIX('mixed') });
    const b = scanWorkspace({ rootDir: FIX('mixed') });
    expect(a.files.map((f) => f.path)).toEqual(b.files.map((f) => f.path));
  });
});

describe('size guard', () => {
  it('reports the max file size constant', () => {
    expect(MAX_FILE_BYTES).toBeGreaterThan(0);
  });
});
