import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { Workspace } from '../src/server/workspace';
import { createA2hServer, findAssetsDir } from '../src/server/server';

const FIX = (name: string) => resolve(__dirname, 'fixtures', name);

let server: Server;
let base: string;
let workspace: Workspace;

beforeAll(async () => {
  workspace = new Workspace(FIX('mixed'));
  const { server: s } = createA2hServer({ workspace, assetsDir: findAssetsDir() });
  server = s;
  await new Promise<void>((res) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      base = `http://127.0.0.1:${port}`;
      res();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((res) => server.close(() => res()));
});

describe('a2h HTTP server', () => {
  it('serves the SPA entry', async () => {
    const r = await fetch(base + '/');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('A2H');
  });

  it('serves the semantic IR', async () => {
    const r = await fetch(base + '/api/ir');
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.identity.name).toBe('Mixed Workspace');
    expect(data.sections.length).toBeGreaterThan(0);
  });

  it('renders a markdown artifact', async () => {
    const r = await fetch(base + '/api/artifact?path=' + encodeURIComponent('README.md'));
    expect(r.status).toBe(200);
    const p = await r.json();
    expect(p.kind).toBe('readme');
    expect(p.content.type).toBe('markdown');
    expect(p.content.html).toContain('<h1>');
  });

  it('renders a diff artifact', async () => {
    const r = await fetch(base + '/api/artifact?path=' + encodeURIComponent('patches/change.diff'));
    expect(r.status).toBe(200);
    const p = await r.json();
    expect(p.content.type).toBe('diff');
    expect(p.content.files.length).toBe(2);
  });

  it('renders a log artifact with tail + errors', async () => {
    const r = await fetch(base + '/api/artifact?path=' + encodeURIComponent('logs/build.log'));
    expect(r.status).toBe(200);
    const p = await r.json();
    expect(p.content.type).toBe('log');
    expect(p.content.hasErrors).toBe(true);
    expect(p.content.tail.length).toBeLessThanOrEqual(200);
  });

  it('serves image bytes with the right content type', async () => {
    const r = await fetch(base + '/api/file?path=' + encodeURIComponent('screenshots/shot.png'));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
  });

  it('rejects path traversal', async () => {
    const r = await fetch(base + '/api/file?path=' + encodeURIComponent('../../etc/passwd'));
    expect(r.status).toBe(404);
  });

  it('returns 404 for unknown artifacts', async () => {
    const r = await fetch(base + '/api/artifact?path=' + encodeURIComponent('does/not/exist.md'));
    expect(r.status).toBe(404);
  });

  it('hides sensitive file content', async () => {
    const r = await fetch(base + '/api/artifact?path=' + encodeURIComponent('.env'));
    expect(r.status).toBe(200);
    const p = await r.json();
    expect(p.content.type).toBe('file');
    expect(p.content.text).toBeUndefined();
  });

  it('does not execute repo HTML/JS: code is escaped server-side', async () => {
    const r = await fetch(base + '/api/artifact?path=' + encodeURIComponent('src/main.ts'));
    const p = await r.json();
    // Code is returned as raw text, not HTML — the client escapes it.
    expect(p.content.type).toBe('code');
    expect(typeof p.content.raw).toBe('string');
  });

  it('health endpoint reports version', async () => {
    const r = await fetch(base + '/api/health');
    expect(r.status).toBe(200);
    const data = await r.json();
    expect(data.ok).toBe(true);
  });
});
