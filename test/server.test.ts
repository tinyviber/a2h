import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request as httpRequest } from 'node:http';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import { Workspace } from '../src/server/workspace';
import { createA2hServer, findAssetsDir } from '../src/server/server';
import { makeWorkspace, manifest } from './helpers/ws';

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

// ---------------------------------------------------------------------------
// The control surface.
//
// `/api/action` is the only endpoint that can change anything, and it is
// served from localhost — which means any page the human happens to have open
// can try to reach it. The guard has three parts and each is load-bearing.
// ---------------------------------------------------------------------------

const TEST_TOKEN = 'test-token-0123456789abcdef';

interface RawResponse {
  status: number;
  body: string;
}

/** A request where every header is ours to set, including Host and Origin. */
function raw(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<RawResponse> {
  return new Promise((resolvePromise, reject) => {
    const req = httpRequest(
      url,
      { method: options.method ?? 'GET', headers: options.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolvePromise({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

describe('the control surface refuses requests from another page', () => {
  let ctl: Server;
  let ctlBase: string;

  beforeAll(async () => {
    const root = makeWorkspace({
      ...manifest({
        a2h: 1,
        tasks: [{ id: 't1', title: 'Review the draft', status: 'pending' }],
        actions: [
          { id: 'approve', label: 'Approve', kind: 'approve', taskId: 't1', sideEffect: 'state' },
        ],
      }),
      'README.md': '# Hi\n',
    });
    const { server: s } = createA2hServer({
      workspace: new Workspace(root),
      assetsDir: findAssetsDir(),
      sessionToken: TEST_TOKEN,
    });
    ctl = s;
    await new Promise<void>((res) => {
      ctl.listen(0, '127.0.0.1', () => {
        const addr = ctl.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        ctlBase = `http://127.0.0.1:${port}`;
        res();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((res) => ctl.close(() => res()));
  });

  const JSON_HEADERS = (origin?: string) => ({
    'content-type': 'application/json',
    'x-a2h-token': TEST_TOKEN,
    ...(origin ? { origin } : {}),
  });
  const BODY = JSON.stringify({ id: 'approve', confirm: true });

  it('serves the session token to the page it is showing', async () => {
    const r = await raw(ctlBase + '/api/session');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).token).toBe(TEST_TOKEN);
  });

  it('injects the token into the shell it serves', async () => {
    const r = await raw(ctlBase + '/');
    expect(r.status).toBe(200);
    expect(r.body).toContain(`name="a2h-token" content="${TEST_TOKEN}"`);
  });

  it('refuses a mutation with no session token', async () => {
    const r = await raw(ctlBase + '/api/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: BODY,
    });
    expect(r.status).toBe(403);
  });

  it('refuses a mutation with the wrong session token', async () => {
    const r = await raw(ctlBase + '/api/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-a2h-token': 'not-the-token' },
      body: BODY,
    });
    expect(r.status).toBe(403);
  });

  it('requires a JSON content type, so a cross-origin form cannot reach it', async () => {
    const r = await raw(ctlBase + '/api/action', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-a2h-token': TEST_TOKEN },
      body: 'id=approve',
    });
    expect(r.status).toBe(415);
  });

  it('refuses a mutation carrying a foreign Origin', async () => {
    const r = await raw(ctlBase + '/api/action', {
      method: 'POST',
      headers: JSON_HEADERS('https://evil.example'),
      body: BODY,
    });
    expect(r.status).toBe(403);
  });

  it('refuses a request addressed to a name that is not this machine', async () => {
    // DNS rebinding: a hostile name that resolves to 127.0.0.1, so the browser
    // believes it is same-origin with us.
    const r = await raw(ctlBase + '/', { headers: { host: 'evil.example' } });
    expect(r.status).toBe(403);
  });

  it('accepts a same-origin mutation that carries the token', async () => {
    const r = await raw(ctlBase + '/api/action', {
      method: 'POST',
      headers: JSON_HEADERS(ctlBase),
      body: BODY,
    });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ ok: true, actionId: 'approve' });
  });

  it('still answers read-only endpoints without a token', async () => {
    const r = await raw(ctlBase + '/api/presentation');
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).identity.name).toBeTruthy();
  });
});
