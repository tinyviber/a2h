import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Workspace } from './workspace';
import { resolveRealPath } from './safePath';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

// Restrictive CSP: no external scripts/images/connections, no inline script.
const PAGE_CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'";

const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'";

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
  const assetsDir = options.assetsDir ?? findAssetsDir();

  // SSE subscribers for watch mode.
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
    setBaseHeaders(res);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    try {
      if (req.method === 'GET' && pathname === '/api/ir') {
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

      if (req.method === 'GET' && pathname === '/api/events') {
        subscribeSse(req, res, subscribers);
        return;
      }

      if (req.method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, { ok: true, version: workspace.version });
        return;
      }

      // Static assets / SPA entry.
      serveStatic(res, assetsDir, pathname);
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal error' });
      } else {
        res.end();
      }
    }
  });

  return { server, broadcast, host };
}

function setBaseHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(json));
  res.end(json);
}

function serveFile(res: ServerResponse, workspace: Workspace, rel: string): void {
  if (!rel) {
    sendJson(res, 400, { error: 'missing path' });
    return;
  }
  const real = resolveRealPath(workspace.rootDir, rel);
  if (real === null) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  const ext = extOf(real);
  const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';

  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  if (ext === '.svg') res.setHeader('Content-Security-Policy', SVG_CSP);

  const size = statSync(real).size;
  res.setHeader('Content-Length', size);

  const stream = createReadStream(real);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.statusCode = 500;
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

function serveStatic(
  res: ServerResponse,
  assetsDir: string,
  pathname: string,
): void {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (rel === '/index.html' || rel === '/styles.css' || rel === '/app.js') {
    const filePath = join(assetsDir, rel.slice(1));
    if (existsSync(filePath)) {
      const contentType = CONTENT_TYPES[extOf(filePath)] ?? 'application/octet-stream';
      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      if (rel === '/index.html') res.setHeader('Content-Security-Policy', PAGE_CSP);
      const stream = createReadStream(filePath);
      stream.on('error', () => res.end());
      stream.pipe(res);
      return;
    }
  }
  // Fall back to index.html for unknown non-API paths (SPA).
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

function extOf(p: string): string {
  const dot = p.lastIndexOf('.');
  return dot >= 0 ? p.slice(dot).toLowerCase() : '';
}
