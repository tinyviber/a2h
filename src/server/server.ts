import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import type { Workspace } from './workspace';
import { isWithin, resolveRealPath } from './safePath';

// ---------------------------------------------------------------------------
// The local server.
//
// Security posture (this is a local-first tool, so the threat model is "the
// workspace content is untrusted"):
//
//   * The server binds to 127.0.0.1 by default.
//   * Repository content is never executed. Markdown HTML is escaped, code is
//     sent as text, and raw file serving is restricted to *inline-safe image
//     types only* — so a `.html` or `.js` file in the workspace can never be
//     served as an executable same-origin document.
//   * Sensitive files and symlinks are never served as bytes.
//   * Actions can only reference ids declared in the workspace manifest, and
//     go through the ActionEngine's confirmation boundary.
// ---------------------------------------------------------------------------

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Types that may be served from a workspace path. Images are safe to inline:
 * none of them can execute script in the document context. SVG is allowed but
 * always carries a restrictive CSP. Everything else (html, js, css, svg-as-doc,
 * json, and all binaries) is refused.
 */
const INLINE_SAFE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif', '.tif', '.tiff', '.svg',
]);

const ASSET_EXTS = new Set(['.html', '.css', '.js', '.mjs', '.svg', '.png', '.json', '.map', '.woff2']);

// Restrictive CSP: no external scripts/images/connections, no inline script.
const PAGE_CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'";

const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'";

const MAX_ACTION_BODY_BYTES = 64 * 1024;

export interface ServerOptions {
  workspace: Workspace;
  host?: string;
  onListening?: (url: string) => void;
  assetsDir?: string;
}

export function findAssetsDir(): string {
  // Compiled layout: dist/server/server.js -> dist/renderer/assets
  return join(__dirname, '..', 'renderer', 'assets');
}

export function createA2hServer(options: ServerOptions) {
  const { workspace } = options;
  const host = options.host ?? '127.0.0.1';
  const assetsDir = resolve(options.assetsDir ?? findAssetsDir());

  // SSE subscribers for watch mode and action results.
  const subscribers = new Set<ServerResponse>();

  function broadcast(event: string): void {
    for (const res of subscribers) {
      try {
        res.write(`data: ${event}\n\n`);
      } catch {
        subscribers.delete(res);
      }
    }
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setBaseHeaders(res);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, url);
      return;
    }
    serveStatic(res, assetsDir, pathname);
  }

  async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    url: URL,
  ): Promise<void> {
    // Canonical name for the view payload. `/api/ir` is kept as an alias: it
    // was the original spelling, and the body is a presentation, not the IR.
    if (req.method === 'GET' && (pathname === '/api/presentation' || pathname === '/api/ir')) {
      sendJson(res, 200, workspace.presentation);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/artifact') {
      const rel = url.searchParams.get('path') ?? '';
      const mode = url.searchParams.get('mode') === 'full' ? 'full' : 'tail';
      const payload = workspace.renderPayload(rel, mode);
      if (!payload) {
        sendJson(res, 404, { error: 'artifact not found' });
        return;
      }
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/file') {
      serveFile(res, workspace, url.searchParams.get('path') ?? '');
      return;
    }

    if (pathname === '/api/action') {
      await handleAction(req, res);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/events') {
      subscribeSse(req, res, subscribers);
      return;
    }

    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        version: workspace.version,
        semantics: workspace.presentation.semantics,
        simulatedActions: workspace.presentation.simulatedActions,
        providers: workspace.registry.executors.map((e) => e.id),
        tasks: workspace.presentation.tasks.length,
        artifacts: workspace.presentation.stats.artifacts,
      });
      return;
    }

    sendJson(res, 404, { error: 'unknown endpoint' });
  }

  async function handleAction(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }

    let body: string;
    try {
      body = await readBody(req, MAX_ACTION_BODY_BYTES);
    } catch (err) {
      sendJson(res, 413, { error: (err as Error).message });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body || '{}');
    } catch {
      sendJson(res, 400, { error: 'body must be JSON' });
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      sendJson(res, 400, { error: 'body must be a JSON object' });
      return;
    }

    const record = parsed as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    if (!id) {
      sendJson(res, 400, { error: 'missing action id' });
      return;
    }

    const result = await workspace.engine.execute(
      {
        id,
        params:
          typeof record.params === 'object' && record.params !== null && !Array.isArray(record.params)
            ? (record.params as Record<string, string>)
            : undefined,
        confirm: record.confirm === true,
      },
      workspace.declaredActions(),
    );

    if (result.ok) {
      broadcast('action');
      sendJson(res, 200, result);
      return;
    }

    const status =
      result.error === 'unknown_action' ? 404
        : result.error === 'confirmation_required' ? 409
          : result.error === 'missing_params' ? 400
            : 400;
    sendJson(res, status, result);
  }

  return { server, broadcast, host };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setBaseHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(json));
  res.end(json);
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => reject(err));
  });
}

/**
 * Serves raw bytes for a workspace file, subject to a strict allowlist. Only
 * files the scanner knows about, that are not sensitive and not symlinks, and
 * whose type cannot execute in the document context, are served.
 */
function serveFile(res: ServerResponse, workspace: Workspace, rel: string): void {
  if (!rel) {
    sendJson(res, 400, { error: 'missing path' });
    return;
  }

  // The scanner's view of the workspace is the allowlist.
  const entry = workspace.getFile(rel);
  if (!entry) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  if (entry.sensitive) {
    sendJson(res, 403, { error: 'sensitive file' });
    return;
  }
  if (entry.isSymlink) {
    sendJson(res, 403, { error: 'symlink not served' });
    return;
  }

  const ext = extname(rel).toLowerCase();
  if (!INLINE_SAFE_EXTS.has(ext)) {
    sendJson(res, 403, { error: `type ${ext || '(none)'} is not served inline` });
    return;
  }

  // Re-validate containment on the real path (defence in depth).
  const real = resolveRealPath(workspace.rootDir, rel);
  if (real === null) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  let size: number;
  try {
    size = statSync(real).size;
  } catch {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
  res.setHeader('Content-Length', size);
  res.setHeader('Content-Disposition', 'inline');
  if (ext === '.svg') res.setHeader('Content-Security-Policy', SVG_CSP);

  const stream = createReadStream(real);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end();
    } else {
      res.end();
    }
  });
  stream.pipe(res);
}

function subscribeSse(
  req: IncomingMessage,
  res: ServerResponse,
  subscribers: Set<ServerResponse>,
): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.write('retry: 1000\n\n');
  subscribers.add(res);
  req.on('close', () => subscribers.delete(res));
}

/**
 * Static assets for the viewer itself. Only known asset extensions are served,
 * and the resolved path must stay inside the assets directory, so a crafted
 * URL cannot read anything else on disk.
 */
function serveStatic(res: ServerResponse, assetsDir: string, pathname: string): void {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = rel.replace(/\/+/g, '/');

  const ext = extname(rel).toLowerCase();
  if (ASSET_EXTS.has(ext)) {
    const candidate = resolve(assetsDir, `.${rel}`);
    if (isWithin(assetsDir, candidate) && existsSync(candidate)) {
      let isFile = false;
      try {
        isFile = statSync(candidate).isFile();
      } catch {
        isFile = false;
      }
      if (isFile) {
        res.statusCode = 200;
        res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
        if (rel === '/index.html') res.setHeader('Content-Security-Policy', PAGE_CSP);
        const stream = createReadStream(candidate);
        stream.on('error', () => res.end());
        stream.pipe(res);
        return;
      }
    }
  }

  // SPA fallback: unknown paths get the shell so client-side routes work.
  const index = join(assetsDir, 'index.html');
  if (existsSync(index)) {
    res.statusCode = 200;
    res.setHeader('Content-Type', CONTENT_TYPES['.html']!);
    res.setHeader('Content-Security-Policy', PAGE_CSP);
    createReadStream(index).pipe(res);
  } else {
    res.statusCode = 404;
    res.end('a2h renderer assets missing — run the build first');
  }
}
