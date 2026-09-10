import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { main } from '../src/cli/index';

// Documentation claims about other files rot silently: nothing compiles them,
// so a link that points outside the tree, or a promise the CLI does not keep,
// survives review and ships. These assertions pin the claims the 0.1.1 review
// turned on — where each skill copy's spec link points, what `validate`
// actually promises, and which invocation a published install implies.

const ROOT = resolve(__dirname, '..');
const SKILL_DOC = 'docs/agent-skill.md';
const SKILL_COPY = 'examples/agent-skill/SKILL.md';

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** Inline markdown link targets, minus anchors and absolute/remote URLs. */
function relativeLinks(markdown: string): string[] {
  const out: string[] = [];
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0].trim();
    if (!target) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, mailto:, …
    if (target.startsWith('//') || target.startsWith('#')) continue;
    out.push(target);
  }
  return out;
}

/** Runs the CLI and returns what it printed. */
function capture(argv: string[]): string {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.join(' '));
  });
  try {
    main(argv);
  } finally {
    spy.mockRestore();
  }
  return lines.join('\n');
}

describe('the skill links resolve where each copy actually lives', () => {
  // The two copies are the same instructions in two directories, so one shared
  // relative path cannot be correct in both. Each names the spec relative to
  // itself, which is why they must not be forced byte-identical.
  it('links the spec as a sibling from docs/', () => {
    const md = read(SKILL_DOC);
    expect(md).toContain('](protocol.md)');
    expect(md).not.toContain('../../docs/protocol.md');
  });

  it('links the spec through the repo tree from examples/agent-skill/', () => {
    const md = read(SKILL_COPY);
    expect(md).toContain('](../../docs/protocol.md)');
    expect(md).not.toContain('](protocol.md)');
  });

  it('says on its face that the examples copy is a drop-in', () => {
    expect(read(SKILL_COPY)).toMatch(/drop-in skill/i);
  });

  it('keeps the instructional body the same in both copies', () => {
    // Same instructions, deliberately different link targets. The body between
    // these two headings carries no links, so it must match exactly; the drop-in
    // note at the top of the examples copy is the only intended difference.
    const body = (md: string): string =>
      md.slice(md.indexOf('## When to act'), md.indexOf('## Commands')).trim();
    expect(body(read(SKILL_COPY))).toBe(body(read(SKILL_DOC)));
  });

  it('every relative link in the docs and the README resolves inside the repo', () => {
    const files = ['README.md', 'docs/protocol.md', SKILL_DOC, SKILL_COPY];
    for (const file of files) {
      const base = dirname(join(ROOT, file));
      const links = relativeLinks(read(file));
      expect(links.length, `${file} should link to something`).toBeGreaterThan(0);
      for (const target of links) {
        const abs = resolve(base, target);
        expect(existsSync(abs), `${file} → ${target} does not exist`).toBe(true);
        // A link that resolves outside the tree is one GitHub cannot serve.
        expect(abs === ROOT || abs.startsWith(`${ROOT}/`), `${file} → ${target} escapes the repo`).toBe(true);
      }
    }
  });
});

describe('the docs state what validate actually does', () => {
  it('does not claim validate reports which layer won', () => {
    // Precedence is field-level and internal; validate never prints a winner.
    expect(read('docs/protocol.md')).not.toMatch(/reports which layer won/i);
  });

  it('states the real exit-code contract in both skill copies', () => {
    for (const file of [SKILL_DOC, SKILL_COPY]) {
      const md = read(file);
      expect(md, file).not.toMatch(/exit code 0 means a human can be shown this/i);
      expect(md, file).toMatch(/Exit \*\*1\*\*/);
      expect(md, file).toMatch(/Exit \*\*0\*\*/);
      // Both named examples of an error must be there, not just the words.
      // `\s+` rather than a literal space: prose wraps, and a test that breaks
      // when a line rewraps is testing the formatter, not the contract.
      expect(md, file).toMatch(/missing\s+item\s+path/);
      expect(md, file).toMatch(/refused\s+to\s+read/);
    }
  });

  it('agrees with the CLI help about what exits 1', () => {
    const help = capture(['--help']);
    expect(help).toMatch(/validate exits 1 only when/);
    expect(help).toMatch(/missing item path/);
    expect(read('docs/protocol.md')).toMatch(/a missing item path/);
  });
});

describe('a published invocation names the published package', () => {
  it('never shows a bare `npx a2h`, which would not resolve', () => {
    for (const file of ['README.md', 'CHANGELOG.md', SKILL_DOC, SKILL_COPY]) {
      expect(read(file), file).not.toMatch(/npx a2h\b/);
    }
    expect(capture(['--help'])).not.toMatch(/npx a2h\b/);
  });

  it('says the package is scoped, and that the command it installs is not', () => {
    expect(read('README.md')).toMatch(/`@tinyviber\/a2h`/);
    expect(read('README.md')).toMatch(/exposes the command `a2h`/);
    const help = capture(['--help']);
    expect(help).toMatch(/@tinyviber\/a2h/);
    expect(help).toMatch(/exposes the command a2h/);
  });

  it('keeps clone-only example paths labelled as clone-only', () => {
    const readme = read('README.md');
    const examples = readme.slice(readme.indexOf('## Examples'), readme.indexOf('## CLI'));
    expect(examples).toMatch(/clone of this repository/);
    // The moment `examples/` stops being a clone-only path, that note is a lie.
    expect(existsSync(join(ROOT, 'examples/radar'))).toBe(true);
    expect(statSync(join(ROOT, 'examples/radar')).isDirectory()).toBe(true);
  });

  it('does not imply the npm tarball ships examples/', () => {
    const pkg = JSON.parse(read('package.json')) as { files: string[] };
    expect(pkg.files).not.toContain('examples');
  });
});

describe('the version has one source', () => {
  afterEach(() => vi.restoreAllMocks());

  it('--version follows package.json, with no second constant to keep in sync', () => {
    const pkg = JSON.parse(read('package.json')) as { name: string; version: string };
    expect(pkg.name).toBe('@tinyviber/a2h');
    expect(pkg.version).toBe('0.1.1');
    expect(capture(['--version'])).toBe(`${pkg.name} ${pkg.version}`);
  });

  it('leaves no VERSION constant behind in the CLI', () => {
    expect(read('src/cli/index.ts')).not.toMatch(/^const VERSION = /m);
  });

  it('leaves 0.2.0 unused', () => {
    expect(read('package.json')).not.toContain('0.2.0');
    expect(read('package-lock.json')).not.toContain('0.2.0');
    expect(read('CHANGELOG.md')).not.toMatch(/## \[0\.2\.0\]/);
  });

  it('aligns the lockfile with the manifest', () => {
    const pkg = JSON.parse(read('package.json')) as { name: string; version: string };
    const lock = JSON.parse(read('package-lock.json')) as {
      name: string;
      version: string;
      packages: Record<string, { name?: string; version?: string }>;
    };
    expect(lock.name).toBe(pkg.name);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].name).toBe(pkg.name);
    expect(lock.packages[''].version).toBe(pkg.version);
  });
});

describe('the viewer copy is honest about where state lives', () => {
  it('says decisions on disk are the record, and that task status is not', () => {
    const js = read('src/renderer/assets/js/views.js');
    expect(js).toMatch(/record of what the human did/i);
    expect(js).toMatch(/task status still comes from the manifest/i);
    // The claim this replaced — that nothing is written to disk — is now false.
    expect(js).not.toMatch(/Nothing is written to disk/i);
  });

  it('ships the same viewer copy in dist after a build', () => {
    // copy-assets mirrors src/renderer/assets into dist; if the built copy
    // disagrees, the served page is not the one reviewed.
    const dist = join(ROOT, 'dist/renderer/assets/js/views.js');
    if (!existsSync(dist)) return; // dist is a build artifact, not committed state
    expect(read('dist/renderer/assets/js/views.js')).toBe(read('src/renderer/assets/js/views.js'));
  });

  it('does not hand the renderer a restyled audit section', () => {
    // 3.4 is copy-only: no new class, no stylesheet edit.
    const styles = readdirSync(join(ROOT, 'src/renderer/assets')).filter((n) => n.endsWith('.css'));
    for (const name of styles) {
      expect(read(`src/renderer/assets/${name}`)).not.toMatch(/decision-record|audit-note/);
    }
  });
});
