import { describe, it, expect } from 'vitest';
import { Workspace } from '../src/server/workspace';
import { makeWorkspace, manifest, symlink, fixturePng } from './helpers/ws';

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
