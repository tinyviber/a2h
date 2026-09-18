import { createReadStream, closeSync, existsSync, fstatSync, readFileSync, statSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import type { Workspace } from './workspace';
import { isWithin, resolveRealPath } from '../security/boundary';
import { openNoFollow } from '../util/safeRead';

// ---------------------------------------------------------------------------
// The local server.
//
// Security posture (this is a local-first tool, so the threat model is "the
// workspace content is untrusted, and so is every other page the human has
// open in a browser"):
//
//   * The server binds to 127.0.0.1 by default.
//   * Repository content is never executed. Markdown HTML is escaped, code is
//     sent as text, and raw file serving is restricted to *inline-safe image
//     types only* — so a `.html` or `.js` file in the workspace can never be
//     served as an executable same-origin document.
//   * Sensitive files and symlinks are never served as bytes.
//   * Actions can only reference ids declared in the workspace manifest, and
//     go through the ActionEngine's confirmation boundary.
//
// The last point is the one that grows teeth later. Today the executor is a
// mock, so the worst a forged request achieves is a simulated run in someone
// else's tab. The moment a real provider is registered behind `/api/action`,
// this endpoint *is* a local control API, and the browser is the delivery
// mechanism. So the mutation guard is built now, while it is still cheap:
//
//   * Host must name this machine. A hostile page can point a name it controls
//     at 127.0.0.1 (DNS rebinding) and the browser will happily treat us as
//     same-origin; requiring the Host header to be local breaks that.
//   * Content-Type must be application/json, which forces a cross-origin
//     caller into a preflight we never answer.
//   * A session token, minted per process and handed out only to the page we
//     serve, must be presented. A cross-origin page cannot read it.
//
// Any one of the three is bypassable in isolation; together they are not.
// ---------------------------------------------------------------------------

/** Hostnames a request to this server may legitimately carry. */
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);

/** A bind address that means "listen everywhere" — the host check is skipped. */
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '']);

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
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
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

const ASSET_EXTS = new Set(['.html', '.css', '.js', '.mjs', '.svg', '.png', '.json', '.map', '.woff2', '.woff', '.ttf']);

// Restrictive CSP: no external scripts/images/connections, no inline script.
const PAGE_CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'";

const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'";

const MAX_ACTION_BODY_BYTES = 64 * 1024;

/** How long the session token is, in bytes, before hex encoding. */
const TOKEN_BYTES = 24;

/** Methods that change something. Every one of them goes through the guard. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface ServerOptions {
  workspace: Workspace;
  host?: string;
  onListening?: (url: string) => void;
  assetsDir?: string;
  /** Overrides the per-process session token. Tests use this; nothing else should. */
  sessionToken?: string;
}

export function findAssetsDir(): string {
  // Compiled layout: dist/server/server.js -> dist/renderer/assets
  return join(__dirname, '..', 'renderer', 'assets');
}

export function createA2hServer(options: ServerOptions) {
  const { workspace } = options;
  const host = options.host ?? '127.0.0.1';
  const assetsDir = resolve(options.assetsDir ?? findAssetsDir());

  // Minted once per process. Not persisted: restarting the server invalidates
  // every tab, which is the right trade for a token that only ever needs to
  // outlive a browsing session.
  const sessionToken = options.sessionToken ?? randomBytes(TOKEN_BYTES).toString('hex');
  const hostCheckEnabled = !WILDCARD_HOSTS.has(host);
  const shell = buildShell(assetsDir, sessionToken);

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

    if (hostCheckEnabled && !isLocalHostname(req.headers.host, host)) {
      sendJson(res, 403, { error: 'unexpected host' });
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname, url);
      return;
    }
    serveStatic(res, assetsDir, pathname, shell);
  }

  async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    url: URL,
  ): Promise<void> {
    const method = req.method ?? 'GET';

    // One guard, applied to every mutating request that will ever exist here,
    // rather than a check bolted onto `/api/action` that the next endpoint
    // forgets to copy.
    if (MUTATING_METHODS.has(method)) {
      const refusal = guardMutation(req, hostCheckEnabled ? host : undefined);
      if (refusal) {
        sendJson(res, refusal.status, { error: refusal.error });
        return;
      }
    }

    // Canonical name for the view payload. `/api/ir` is kept as an alias: it
    // was the original spelling, and the body is a presentation, not the IR.
    if (method === 'GET' && (pathname === '/api/presentation' || pathname === '/api/ir')) {
      sendJson(res, 200, workspace.presentation);
      return;
    }

    if (method === 'GET' && pathname === '/api/artifact') {
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

    if (method === 'GET' && pathname === '/api/file') {
      serveFile(res, workspace, url.searchParams.get('path') ?? '');
      return;
    }

    if (pathname === '/api/action') {
      await handleAction(req, res);
      return;
    }

    // Same-origin only, and `no-store` — this is the one response that must
    // never end up in a shared cache.
    if (method === 'GET' && pathname === '/api/session') {
      res.setHeader('Cache-Control', 'no-store');
      sendJson(res, 200, { token: sessionToken });
      return;
    }

    if (method === 'GET' && pathname === '/api/events') {
      subscribeSse(req, res, subscribers);
      return;
    }

    if (method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        version: workspace.version,
        semantics: workspace.presentation.semantics,
        simulatedActions: workspace.presentation.simulatedActions,
        providers: workspace.registry.executors.map((e) => e.id),
        tasks: workspace.presentation.tasks.length,
        artifacts: workspace.presentation.stats.artifacts,
        secured: hostCheckEnabled,
      });
      return;
    }

    sendJson(res, 404, { error: 'unknown endpoint' });
  }

  /**
   * The mutation guard. Returns a refusal, or undefined to proceed.
   *
   * The token comparison is constant-time; the length pre-check exists because
   * `timingSafeEqual` throws on a length mismatch rather than returning false.
   */
  function guardMutation(
    req: IncomingMessage,
    bindingHost: string | undefined,
  ): { status: number; error: string } | undefined {
    if (bindingHost && !isLocalOrigin(req.headers.origin, bindingHost)) {
      return { status: 403, error: 'cross-origin request refused' };
    }

    const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      return { status: 415, error: 'content-type must be application/json' };
    }

    const supplied = req.headers['x-a2h-token'];
    if (typeof supplied !== 'string' || supplied.length !== sessionToken.length) {
      return { status: 403, error: 'missing or invalid session token' };
    }
    if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(sessionToken))) {
      return { status: 403, error: 'missing or invalid session token' };
    }

    return undefined;
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

/**
 * Extracts a hostname from either a `Host` header (`127.0.0.1:5173`) or an
 * `Origin` header (`http://127.0.0.1:5173`). Brackets around an IPv6 literal
 * are stripped so `[::1]` and `::1` compare equal.
 */
function hostnameOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value.includes('://') ? value : `http://${value}`);
    return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return undefined;
  }
}

/**
 * Whether a `Host` header names this machine.
 *
 * A missing Host is allowed rather than refused: HTTP/1.0 clients and
 * non-browser tooling do not send one, and the token — not this check — is
 * what actually authorises a mutation.
 */
function isLocalHostname(hostHeader: string | undefined, bindingHost: string): boolean {
  const name = hostnameOf(hostHeader);
  if (name === undefined) return true;
  return LOCAL_HOSTNAMES.has(name) || name === bindingHost.toLowerCase();
}

/**
 * Whether an `Origin` header names this machine. A missing Origin means the
 * request did not come from a browser page, so there is no cross-origin
 * confusion to prevent; `"null"` (sandboxed iframes, some redirects) is not
 * local and is refused.
 */
function isLocalOrigin(origin: string | undefined, bindingHost: string): boolean {
  if (origin === undefined || origin === '') return true;
  const name = hostnameOf(origin);
  if (name === undefined) return false;
  return LOCAL_HOSTNAMES.has(name) || name === bindingHost.toLowerCase();
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

  // Opened the same way as every other read in A2H, then handed to the stream
  // as a descriptor: the bytes come from the file we checked, not from
  // whatever the path resolves to a moment later.
  let fd: number;
  try {
    fd = openNoFollow(real);
  } catch {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  let size: number;
  try {
    size = fstatSync(fd).size;
  } catch {
    closeSync(fd);
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');
  res.setHeader('Content-Length', size);
  res.setHeader('Content-Disposition', 'inline');
  if (ext === '.svg') res.setHeader('Content-Security-Policy', SVG_CSP);

  const stream = createReadStream(real, { fd });
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
 *
 * `shell` is index.html with the session token injected; it is served in place
 * of the file on disk so the token never has to be written anywhere.
 */
function serveStatic(
  res: ServerResponse,
  assetsDir: string,
  pathname: string,
  shell: Buffer | undefined,
): void {
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
        if (rel === '/index.html' && shell) {
          sendShell(res, shell);
          return;
        }
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
  if (shell) {
    sendShell(res, shell);
    return;
  }
  res.statusCode = 404;
  res.end('a2h renderer assets missing — run the build first');
}

function sendShell(res: ServerResponse, shell: Buffer): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', CONTENT_TYPES['.html']!);
  res.setHeader('Content-Security-Policy', PAGE_CSP);
  // The document carries a per-process token; caching it would hand a stale
  // one to the next tab.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', shell.length);
  res.end(shell);
}

const TOKEN_META = /<meta\s+name="a2h-token"\s+content="[^"]*"\s*\/?>/i;

/**
 * index.html with this process's session token in it.
 *
 * The page needs the token to mutate anything, and the only source of truth
 * for it is this process. Injecting at serve time keeps the token out of the
 * build output, out of git, and out of any on-disk copy of the shell.
 */
function buildShell(assetsDir: string, token: string): Buffer | undefined {
  const file = join(assetsDir, 'index.html');
  if (!existsSync(file)) return undefined;
  try {
    const html = readFileSync(file, 'utf8');
    const meta = `<meta name="a2h-token" content="${token}" />`;
    const withToken = TOKEN_META.test(html)
      ? html.replace(TOKEN_META, meta)
      : html.replace(/<\/head>/i, `  ${meta}\n</head>`);
    return Buffer.from(withToken, 'utf8');
  } catch {
    return undefined;
  }
}
