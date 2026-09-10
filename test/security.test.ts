import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import type { FileEntry } from '../src/types';
import { Workspace } from '../src/server/workspace';
import { createWorkspaceReader } from '../src/security/workspaceRead';
import { makeWorkspace, manifest, symlink, fixturePng } from './helpers/ws';

/** A FileEntry for `rel`, as the scanner would record it. */
function entry(root: string, rel: string, overrides: Partial<FileEntry> = {}): FileEntry {
  const slash = rel.lastIndexOf('/');
  return {
    path: rel,
    absolutePath: join(root, rel),
    kind: 'other',
    size: 0,
    mtimeMs: 0,
    ext: slash === -1 ? (rel.includes('.') ? rel.split('.').pop()! : '') : '',
    isSymlink: false,
    sensitive: false,
    depth: rel.split('/').length - 1,
    ...overrides,
  };
}

// What a workspace can and cannot make A2H reveal.
//
// A2H reads a directory tree it does not own and shows the result in a browser.
// The boundary has three parts, and all three are enforced here rather than in
// the UI: sensitive files, symlinks, and non-previewable binaries.

describe('sensitive files', () => {
  const SECRETS = {
    '.env': 'API_KEY=super-secret-value\n',
    'config/credentials.json': '{"password":"hunter2"}',
    'deploy/id_rsa': '-----BEGIN OPENSSH PRIVATE KEY-----\n',
    'notes/api-token.txt': 'token=abc123',
    'certs/server.pem': '-----BEGIN CERTIFICATE-----\n',
  };

  it('never returns content for a sensitive file', () => {
    const root = makeWorkspace({ ...SECRETS, 'README.md': '# Hi\n' });
    const ws = new Workspace(root);

    for (const path of Object.keys(SECRETS)) {
      const payload = ws.renderPayload(path);
      expect(payload, `${path} should still be listed`).toBeDefined();
      const content = payload!.content as { text?: string; html?: string; note?: string };
      expect(content.note, `${path} should be withheld`).toMatch(/sensitive/i);
      // The decisive check: the secret string appears nowhere in the payload.
      const serialised = JSON.stringify(payload);
      expect(serialised).not.toContain('super-secret-value');
      expect(serialised).not.toContain('hunter2');
      expect(serialised).not.toContain('abc123');
    }
  });

  it('marks the artifact summary as withheld', () => {
    const ws = new Workspace(makeWorkspace({ ...SECRETS, 'README.md': '# Hi\n' }));
    const view = ws.presentation.sections
      .flatMap((s) => s.artifacts)
      .find((a) => a.id === '.env');
    expect(view?.summary).toMatch(/sensitive/i);
  });

  it('still lists the file, so a human can see it exists', () => {
    const ws = new Workspace(makeWorkspace({ ...SECRETS, 'README.md': '# Hi\n' }));
    expect(ws.getFile('.env')).toBeDefined();
  });
});

describe('symlinks are never followed', () => {
  it('does not read an outside file through a markdown-looking link', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    symlink(root, 'notes.md', '/etc/passwd');
    const ws = new Workspace(root);

    const payload = ws.renderPayload('notes.md')!;
    expect(payload.content).toMatchObject({ note: 'Symlink (not followed)' });
    expect(JSON.stringify(payload)).not.toContain('root:');
  });

  it('does not let a link contribute a title or a summary to the UI', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    symlink(root, 'linked.md', '/etc/passwd');
    const ws = new Workspace(root);

    const view = ws.presentation.sections
      .flatMap((s) => s.artifacts)
      .find((a) => a.id === 'linked.md')!;
    expect(view).toBeDefined();
    // The filename supplies the title; the target supplies nothing.
    expect(view.title).toBe('linked');
    expect(view.summary).toMatch(/symlink/i);
    expect(JSON.stringify(view)).not.toMatch(/root|daemon|nobody/);
  });

  it('treats a linked image as unusable rather than as an image', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    symlink(root, 'shot.png', '/etc/passwd');
    const ws = new Workspace(root);

    // No dimensions can be measured through the link.
    const view = ws.presentation.sections
      .flatMap((s) => s.artifacts)
      .find((a) => a.id === 'shot.png');
    expect(view?.meta?.imageWidth).toBeUndefined();
  });

  it('still renders a real image normally', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n', 'shot.png': fixturePng() });
    const ws = new Workspace(root);

    const view = ws.presentation.sections.flatMap((s) => s.artifacts).find((a) => a.id === 'shot.png')!;
    expect(view.content).toBe('image');
    expect(view.meta?.imageWidth).toBe(320);
    expect(view.meta?.imageHeight).toBe(200);
  });

  it('refuses to read a block through a symlink', () => {
    const root = makeWorkspace({
      ...manifest({
        a2h: 1,
        panels: [{ type: 'markdown', title: 'Leaked?', path: 'notes.md' }],
      }),
      'README.md': '# Hi\n',
    });
    symlink(root, 'notes.md', '/etc/passwd');
    const ws = new Workspace(root);

    // The block is dropped rather than filled with the target's contents.
    expect(ws.presentation.panels).toEqual([]);
    expect(JSON.stringify(ws.presentation.panels)).not.toMatch(/root:.*:0:0/);
  });
});

describe('producer-authored file references go through one capability', () => {
  // A block that names a file is asking the workspace for bytes. Every such
  // request answers the same questions in the same place: is this a file the
  // scanner indexed, is it sensitive, is it a symlink, is it really inside the
  // workspace, and is the read bounded? These tests pin each answer.

  it('refuses a markdown block pointed at a sensitive file', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, panels: [{ type: 'markdown', title: 'Totals', path: '.env' }] }),
      '.env': 'API_KEY=super-secret-value\n',
      'README.md': '# Hi\n',
    });
    const ws = new Workspace(root);

    expect(ws.presentation.panels).toEqual([]);
    expect(JSON.stringify(ws.presentation)).not.toContain('super-secret-value');
  });

  it('refuses a mutable read even when a manifest-level item names a sensitive file', () => {
    const root = makeWorkspace({
      ...manifest({
        a2h: 1,
        tasks: [
          {
            id: 't1',
            title: 'Leak',
            blocks: [{ type: 'markdown', path: 'config/credentials.json' }],
          },
        ],
      }),
      'config/credentials.json': '{"password":"hunter2"}',
      'README.md': '# Hi\n',
    });
    const ws = new Workspace(root);
    const task = ws.presentation.tasks.find((t) => t.id === 't1')!;
    expect(task.blocks).toBeUndefined();
    expect(JSON.stringify(task)).not.toContain('hunter2');
  });

  it('refuses a block pointed at a file the scanner deliberately skipped', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, panels: [{ type: 'markdown', path: 'package-lock.json' }] }),
      'package-lock.json': '{ "name": "not content" }',
      'README.md': '# Hi\n',
    });
    const ws = new Workspace(root);

    // A lockfile is ignored by design. Being ignored is not a way back in
    // through a different door.
    expect(ws.presentation.panels).toEqual([]);
  });

  it('still reads a block pointed at an ordinary workspace file', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, panels: [{ type: 'markdown', path: 'notes/plan.md' }] }),
      'notes/plan.md': '# Plan\n\nStep one.\n',
      'README.md': '# Hi\n',
    });
    const ws = new Workspace(root);

    expect(ws.presentation.panels).toHaveLength(1);
    expect((ws.presentation.panels[0] as unknown as { html: string }).html).toContain('Step one');
  });

  it('does not read through an intermediate directory that links outside', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    symlink(root, 'leak', '/etc');

    // A lying index. The scanner cannot produce this entry — a symlinked
    // directory is recorded as the link, never descended into — which is
    // exactly why containment is re-derived on every read rather than trusted
    // from whoever built the index.
    const reader = createWorkspaceReader({
      rootDir: root,
      files: [entry(root, 'leak/passwd'), entry(root, 'leak/hosts')],
    });

    expect(reader.canReadText('leak/passwd')).toBe(false);
    expect(reader.readText('leak/passwd')).toBeUndefined();
    expect(reader.readText('leak/hosts')).toBeUndefined();
  });

  it('refuses a sensitive path even when the index claims it is ordinary', () => {
    const root = makeWorkspace({ '.env': 'API_KEY=super-secret-value\n' });
    const reader = createWorkspaceReader({
      rootDir: root,
      files: [entry(root, '.env')],
    });

    expect(reader.canReadText('.env')).toBe(false);
    expect(reader.readText('.env')).toBeUndefined();
  });

  it('refuses a path the index flags as a symlink', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    symlink(root, 'notes.md', '/etc/passwd');
    const reader = createWorkspaceReader({
      rootDir: root,
      files: [entry(root, 'notes.md', { isSymlink: true })],
    });

    expect(reader.readText('notes.md')).toBeUndefined();
  });

  it('caps a read, and lets a caller ask for less but never for more', () => {
    const root = makeWorkspace({ 'big.md': 'x'.repeat(4000) });
    const reader = createWorkspaceReader({ rootDir: root, files: [entry(root, 'big.md')] });

    expect(reader.readText('big.md', 100)).toHaveLength(100);
    // Asking for a petabyte gets the ceiling, not a petabyte.
    expect(reader.readText('big.md', Number.MAX_SAFE_INTEGER)!.length).toBe(4000);
  });

  it('treats an image reference as an image only when it really is one', () => {
    const root = makeWorkspace({ 'shot.png': fixturePng(), 'notes.md': '# Hi\n' });
    const reader = createWorkspaceReader({
      rootDir: root,
      files: [entry(root, 'shot.png', { kind: 'image' }), entry(root, 'notes.md', { kind: 'markdown' })],
    });

    expect(reader.canReadImage('shot.png')).toBe(true);
    expect(reader.canReadImage('notes.md')).toBe(false);
    expect(reader.canReadImage('missing.png')).toBe(false);
  });

  it('cannot be talked into a path outside the workspace by lexical tricks', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    const reader = createWorkspaceReader({ rootDir: root, files: [] });

    for (const rel of ['../etc/passwd', './../../etc/passwd', 'a/../../etc/passwd', '/etc/passwd', '']) {
      expect(reader.readText(rel)).toBeUndefined();
      expect(reader.has(rel)).toBe(false);
    }
  });
});

describe('the protocol directory is untrusted input too', () => {
  it('does not read a manifest that is a symlink', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    symlink(root, '.a2h/manifest.json', '/etc/passwd');
    const ws = new Workspace(root);

    expect(ws.presentation.semantics).toBe('inferred');
    expect(ws.presentation.warnings.join(' ')).toMatch(/symlink/i);
    expect(JSON.stringify(ws.presentation)).not.toMatch(/root:.*:0:0/);
  });

  it('does not read run files that are symlinks', () => {
    const root = makeWorkspace({
      'README.md': '# Hi\n',
      '.a2h/runs/real.json': JSON.stringify({ id: 'real-run' }),
    });
    symlink(root, '.a2h/runs/linked.json', '/etc/passwd');
    const ws = new Workspace(root);

    const ids = ws.presentation.runs.map((r) => r.id);
    expect(ids).toContain('real-run');
    expect(ws.presentation.warnings.join(' ')).toMatch(/linked\.json is a symlink/);
  });

  it('refuses a run file too large to be a run record', () => {
    const root = makeWorkspace({
      'README.md': '# Hi\n',
      '.a2h/runs/huge.json': 'x'.repeat(600 * 1024),
    });
    const ws = new Workspace(root);

    expect(ws.presentation.runs).toEqual([]);
    expect(ws.presentation.warnings.join(' ')).toMatch(/too large/);
  });
});

describe('rendering failures never take down the page', () => {
  it('renders a file with an unknown extension without throwing', () => {
    const root = makeWorkspace({
      'README.md': '# Hi\n',
      'misc/mystery.bin': Buffer.from([0x00, 0x01, 0x02, 0xff, 0x00]),
    });
    const ws = new Workspace(root);

    expect(() => ws.renderPayload('misc/mystery.bin')).not.toThrow();
    expect(ws.renderPayload('misc/mystery.bin')?.content).toMatchObject({ isBinary: true });
  });

  it('renders a file that is only NUL bytes', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n', 'x.dat': Buffer.alloc(16) });
    const ws = new Workspace(root);
    expect(() => ws.renderPayload('x.dat')).not.toThrow();
  });

  it('falls back rather than throwing on a malformed patch', () => {
    const root = makeWorkspace({
      'README.md': '# Hi\n',
      'broken.diff': 'diff --git a/x b/x\n@@ this is not a valid hunk\n',
    });
    const ws = new Workspace(root);

    expect(() => ws.renderPayload('broken.diff')).not.toThrow();
    const content = ws.renderPayload('broken.diff')!.content;
    expect(content.type).toBe('diff');
  });

  it('returns nothing for a path that is not in the workspace', () => {
    const ws = new Workspace(makeWorkspace({ 'README.md': '# Hi\n' }));
    expect(ws.renderPayload('../../etc/passwd')).toBeUndefined();
    expect(ws.renderPayload('does/not/exist.md')).toBeUndefined();
  });

  it('returns nothing for a traversal-shaped path even when a manifest claims it', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, items: [{ path: '../../../etc/passwd', role: 'stolen' }] }),
      'README.md': '# Hi\n',
    });
    const ws = new Workspace(root);

    expect(ws.renderPayload('../../../etc/passwd')).toBeUndefined();
    // And it did not sneak into the artifact list as a dead link.
    const ids = ws.presentation.sections.flatMap((s) => s.artifacts).map((a) => a.id);
    expect(ids.some((id) => id.includes('..'))).toBe(false);
  });
});

describe('html is content, not a document', () => {
  // Tags markdown-it may legitimately emit. Anything else in the output means
  // producer-authored markup survived into the rendered document.
  const ALLOWED_TAGS = new Set([
    'p', 'br', 'hr', 'em', 'strong', 'del', 'code', 'pre', 'blockquote',
    'a', 'ul', 'ol', 'li', 'img',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ]);

  function unexpectedTags(html: string): string[] {
    const found = new Set<string>();
    for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)/g)) {
      const tag = m[1]!.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) found.add(tag);
    }
    return [...found];
  }

  /** Raw tags carrying an inline event handler, e.g. `<img onerror=...>`. */
  function handlerBearingTags(html: string): string[] {
    return [...html.matchAll(/<\s*[a-zA-Z][^>]*?\son[a-z]+\s*=/gi)]
      .map((m) => m[0].slice(0, 60));
  }

  it('renders an html file as code rather than as a page', () => {
    const root = makeWorkspace({
      'README.md': '# Hi\n',
      'widget.html': '<script>window.__pwned = true;</script>\n',
    });
    const ws = new Workspace(root);

    const payload = ws.renderPayload('widget.html')!;
    // Typed as code, so no client can mistake it for a document to inject.
    expect(payload.content.type).toBe('code');
    expect(payload.content).not.toHaveProperty('markdown');
  });

  it('escapes markup embedded in markdown instead of emitting it', () => {
    const root = makeWorkspace({
      'evil.md': [
        '# Hi',
        '',
        '<script>alert(1)</script>',
        '',
        '<img src=x onerror="alert(2)">',
        '',
        '<iframe src="https://example.invalid"></iframe>',
        '',
      ].join('\n'),
    });
    const ws = new Workspace(root);

    const html = (ws.renderPayload('evil.md')!.content as { html: string }).html;
    // The decisive property: nothing outside the allowlist became a real tag,
    // and no real tag ended up carrying an inline event handler.
    expect(unexpectedTags(html)).toEqual([]);
    expect(handlerBearingTags(html)).toEqual([]);
    // Escaped rather than silently dropped, so the human still sees the source.
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
  });

  it('escapes markup in a title frontmatter value', () => {
    const root = makeWorkspace({
      ...manifest({
        a2h: 1,
        items: [{ path: 'notes.md', title: '<img src=x onerror=alert(1)>' }],
      }),
      'notes.md': '# Body\n',
    });
    const ws = new Workspace(root);

    // The title is data. It travels as JSON and is set as text by the client;
    // it must never be pre-rendered into the served markup.
    const view = ws.presentation.sections.flatMap((s) => s.artifacts).find((a) => a.id === 'notes.md')!;
    expect(view.title).toBe('<img src=x onerror=alert(1)>');

    const html = (ws.renderPayload('notes.md')!.content as { html: string }).html;
    expect(handlerBearingTags(html)).toEqual([]);
    expect(html).not.toContain('<img');
  });
});
