import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';

// Builds throwaway workspaces on disk. The scanner, the semantics loader and
// the content renderer all talk to the filesystem, so testing them against
// real temp directories is both simpler and more honest than mocking `fs`.

const created: string[] = [];

/** A file's content. A Buffer is written as-is (for binary fixtures). */
export type FileMap = Record<string, string | Buffer>;

export function makeWorkspace(files: FileMap): string {
  const root = mkdtempSync(join(tmpdir(), 'a2h-test-'));
  created.push(root);
  writeFiles(root, files);
  return root;
}

export function writeFiles(root: string, files: FileMap): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

/** Convenience: a manifest written into the canonical location. */
export function manifest(doc: unknown): FileMap {
  return { '.a2h/manifest.json': JSON.stringify(doc, null, 2) };
}

export function symlink(root: string, rel: string, target: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  symlinkSync(target, join(root, rel));
}

/** A real PNG from the shared fixtures, for image-rendering tests. */
export function fixturePng(): Buffer {
  return readFileSync(join(__dirname, '..', 'fixtures', 'mixed', 'screenshots', 'shot.png'));
}

afterEach(() => {
  while (created.length) {
    const dir = created.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});
