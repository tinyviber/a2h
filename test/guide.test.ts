import { describe, it, expect, vi, afterEach } from 'vitest';
import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../src/cli/index';
import { runGuide } from '../src/cli/guide';
import { generateGuide, AGENT_GUIDE_MARKER, AGENT_GUIDE_PATH } from '../src/guide/generate';
import { inspectProject } from '../src/guide/inspect';
import { loadWorkspaceSemantics } from '../src/semantics/load';
import { scanWorkspace } from '../src/scanner/scan';
import { makeWorkspace, manifest, symlink, writeFiles } from './helpers/ws';

// `a2h guide` is the A2H -> Agent direction: it writes project-aware producer
// guidance that the project's own coding agent may read, and may merge into its
// own AGENTS.md. A2H itself never touches AGENTS.md.
//
// Three properties are the whole point, and each is pinned separately:
//
//   deterministic — two runs over an unchanged workspace are byte-identical, so
//                   the file can live in a git repository without churn;
//   safe          — it does not overwrite a file it did not generate, does not
//                   follow a symlink out of the workspace, and never copies a
//                   secret into a file an agent will read;
//   offline       — no network, no model call. If this ever needed an LLM to be
//                   useful, the template would be the thing to shrink.

const SECTION_ORDER = [
  '## Purpose',
  '## Detected project shape',
  '## How to present work in this repository',
  '## Human-facing views',
  '## Existing A2H setup',
  '## Artifact guidance',
  '## Producer workflow',
  '## Validation',
  '## Important boundaries',
];

function read(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

function guideOf(root: string): string {
  const scan = scanWorkspace({ rootDir: root });
  return generateGuide(inspectProject(scan, loadWorkspaceSemantics(root, scan)));
}

/** Runs the CLI in-process, with stdout captured and the exit code isolated. */
function runCli(argv: string[]): { out: string; exitCode: number | undefined } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.join(' '));
  });
  const before = process.exitCode;
  process.exitCode = undefined;
  try {
    main(argv);
  } finally {
    spy.mockRestore();
  }
  const exitCode = process.exitCode;
  process.exitCode = before;
  return { out: lines.join('\n'), exitCode };
}

afterEach(() => vi.restoreAllMocks());

describe('the guide describes how to present work here', () => {
  it('writes a marked guide, in order, of a sane length, for a code repository', () => {
    const root = makeWorkspace({
      'src/index.ts': 'export const x = 1;\n',
      'src/util/helper.ts': 'export const y = 2;\n',
      'README.md': '# A code repository\n',
    });

    expect(runGuide(root).exitCode).toBe(0);

    const guide = read(root, AGENT_GUIDE_PATH);
    expect(guide.startsWith('# A2H producer guide for')).toBe(true);
    expect(guide).toContain(AGENT_GUIDE_MARKER);
    expect(guide).toMatch(/code-heavy/);
    expect(guide).toMatch(/do not present the whole source tree/i);

    const positions = SECTION_ORDER.map((heading) => guide.indexOf(heading));
    expect(positions.every((p) => p >= 0), 'every section is present').toBe(true);
    expect([...positions].sort((a, b) => a - b), 'sections are in order').toEqual(positions);

    // A heading glued to the previous paragraph is not a heading in Markdown;
    // it renders as prose, and the whole guide loses its structure.
    const lines = guide.split('\n');
    for (const heading of SECTION_ORDER) {
      const at = lines.indexOf(heading);
      expect(lines[at - 1], `${heading} must be preceded by a blank line`).toBe('');
    }
    expect(lines[1], 'the marker sits directly under the title').toBe('');
    expect(lines[2]).toBe(AGENT_GUIDE_MARKER);

    const words = guide.trim().split(/\s+/).length;
    expect(words).toBeGreaterThanOrEqual(800);
    expect(words).toBeLessThanOrEqual(2000);
  });

  it('writes materialized-view guidance for a data-heavy workspace, and names no file', () => {
    const root = makeWorkspace({
      'data/corpus.jsonl': '{"a":1}\n',
      'data/rows.sqlite': 'x',
      'reports/findings.md': '# Findings\n',
      'tests/test_rows.py': 'def test_x():\n    pass\n',
      'README.md': '# A corpus\n',
    });

    const guide = guideOf(root);
    expect(guide).toMatch(/materialized/);
    expect(guide).toMatch(/views\/<query>\//);
    expect(guide).toMatch(/source of truth/);
    // Generic advice only: the guide describes a shape, never this repository's
    // files or one project's vocabulary.
    expect(guide).not.toContain('corpus.jsonl');
    expect(guide).not.toContain('rows.sqlite');
    expect(guide.toLowerCase()).not.toContain('cptrain');
  });

  it('counts a corpus directory as data-heavy even without a database file', () => {
    const root = makeWorkspace({
      'corpus/notes-01.md': '# Note\n',
      'corpus/notes-02.md': '# Note\n',
      'README.md': '# Corpus\n',
    });

    const guide = guideOf(root);
    expect(guide).toMatch(/data-heavy/);
    expect(guide).toMatch(/views\/<query>\//);
  });

  it('says to update an existing manifest rather than replace it', () => {
    const root = makeWorkspace({
      ...manifest({ a2h: 1, name: 'Declared', items: [{ path: 'README.md' }] }),
      'README.md': '# Hi\n',
    });

    const guide = guideOf(root);
    expect(guide).toMatch(/already ships `\.a2h\/manifest\.json`/);
    expect(guide).toMatch(/Update it/);
    expect(guide).toMatch(/Do not\s+replace it with a scaffold/);
    expect(guide).not.toMatch(/There is no `\.a2h\/manifest\.json` here/);
  });

  it('says to add meaning when there is no manifest, and that it does not run init', () => {
    const guide = guideOf(makeWorkspace({ 'README.md': '# Hi\n' }));
    expect(guide).toMatch(/There is no `\.a2h\/manifest\.json` here/);
    expect(guide).toMatch(/Do not leave the\s+scaffold as the final description/);
    expect(guide).toMatch(/not run `init` for you/);
  });

  it('mentions AGENTS.md in both directions, and claims no authority over it', () => {
    const without = guideOf(makeWorkspace({ 'README.md': '# Hi\n' }));
    expect(without).toMatch(/There is no `AGENTS\.md`/);
    expect(without).toMatch(/A2H never writes\s+or edits `AGENTS\.md`/);

    const root = makeWorkspace({ 'README.md': '# Hi\n', 'AGENTS.md': '# House rules\n' });
    expect(guideOf(root)).toMatch(/`AGENTS\.md` exists at the repository root/);
  });
});

describe('the guide is deterministic and idempotent', () => {
  it('produces the identical bytes on a second run', () => {
    const root = makeWorkspace({
      'src/index.ts': 'export const x = 1;\n',
      'README.md': '# Hi\n',
    });

    expect(runGuide(root).exitCode).toBe(0);
    const first = read(root, AGENT_GUIDE_PATH);
    expect(runGuide(root).exitCode).toBe(0);
    expect(read(root, AGENT_GUIDE_PATH)).toBe(first);
  });

  it('changes when the workspace changes', () => {
    const root = makeWorkspace({
      'src/index.ts': 'export const x = 1;\n',
      'README.md': '# Hi\n',
    });
    expect(runGuide(root).exitCode).toBe(0);
    const before = read(root, AGENT_GUIDE_PATH);
    expect(before).not.toMatch(/data-heavy/);

    writeFiles(root, { 'data/corpus.jsonl': '{"a":1}\n' });

    expect(runGuide(root).exitCode).toBe(0);
    const after = read(root, AGENT_GUIDE_PATH);
    expect(after).not.toBe(before);
    expect(after).toMatch(/data-heavy/);
  });
});

describe('the guide refuses to clobber what it did not write', () => {
  it('leaves a user-owned file alone and exits 1', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    writeFiles(root, { [AGENT_GUIDE_PATH]: 'my own notes\n' });

    const result = runCli(['guide', root]);
    expect(result.exitCode).toBe(1);
    expect(result.out).toContain(
      '.a2h/agent-guide.md already exists and does not appear to be generated by A2H.',
    );
    expect(result.out).toContain('Use --force to replace it.');
    expect(read(root, AGENT_GUIDE_PATH)).toBe('my own notes\n');
  });

  it('overwrites it with --force', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    writeFiles(root, { [AGENT_GUIDE_PATH]: 'my own notes\n' });

    expect(runCli(['guide', root, '--force']).exitCode).toBe(0);
    expect(read(root, AGENT_GUIDE_PATH)).toContain(AGENT_GUIDE_MARKER);
  });

  it('refuses when .a2h is a symlink, and writes nothing through it', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    const outside = makeWorkspace({ 'kept.txt': 'untouched\n' });
    symlink(root, '.a2h', outside);

    expect(runGuide(root).exitCode).toBe(1);
    expect(readdirSync(outside).sort()).toEqual(['kept.txt']);
  });

  it('refuses when the guide itself is a symlink', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    const outside = makeWorkspace({ 'kept.txt': 'untouched\n' });
    symlink(root, AGENT_GUIDE_PATH, join(outside, 'kept.txt'));

    expect(runGuide(root).exitCode).toBe(1);
    expect(read(outside, 'kept.txt')).toBe('untouched\n');
  });
});

describe('the guide never carries a secret', () => {
  it('says sensitive files exist without copying anything out of them', () => {
    const token = 'sk-live-2f4c9a1b-not-a-real-secret';
    const root = makeWorkspace({
      '.env': `API_KEY=${token}\n`,
      'src/index.ts': 'export const x = 1;\n',
      'README.md': '# Hi\n',
    });

    expect(runGuide(root).exitCode).toBe(0);
    const guide = read(root, AGENT_GUIDE_PATH);

    expect(guide).not.toContain(token);
    expect(guide).not.toContain('API_KEY');
    expect(guide).toMatch(/sensitive/i);
  });

  it('does not write or modify AGENTS.md, even when one exists', () => {
    const root = makeWorkspace({
      'README.md': '# Hi\n',
      'AGENTS.md': '# House rules\n\nBe kind.\n',
    });
    expect(runGuide(root).exitCode).toBe(0);
    expect(read(root, 'AGENTS.md')).toBe('# House rules\n\nBe kind.\n');
  });
});

describe('the shipped corpus fixture stands in for a real data repository', () => {
  const FIXTURE = join(__dirname, 'fixtures', 'corpus');

  it('produces a data-heavy guide from it, and writes nothing into the fixture', () => {
    // Copied out first: a fixture is an input, and generating into it would
    // dirty the tree the same way a committed agent-guide.md would.
    const root = makeWorkspace({});
    for (const entry of readdirSync(FIXTURE)) {
      cpSync(join(FIXTURE, entry), join(root, entry), { recursive: true });
    }

    expect(runGuide(root).exitCode).toBe(0);
    const guide = read(root, AGENT_GUIDE_PATH);

    expect(guide).toMatch(/data-heavy/);
    expect(guide).toMatch(/views\/<query>\//);
    // The conventions it found are named; the files it found are not.
    expect(guide).toMatch(/reports/);
    expect(guide).not.toContain('records-2026-09.jsonl');
    expect(guide).not.toContain('ingest.py');
    expect(guide.toLowerCase()).not.toContain('cptrain');

    expect(existsSync(join(FIXTURE, AGENT_GUIDE_PATH))).toBe(false);
  });
});

describe('the guide command behaves like the other commands', () => {
  it('accepts `guide`, `guide .`, `guide <path>` and `guide --force`', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });

    // `guide` and `guide .` resolve against the process cwd, so they are
    // exercised from inside the throwaway workspace rather than from the repo.
    const cwd = process.cwd();
    let dot: ReturnType<typeof runCli>;
    let bare: ReturnType<typeof runCli>;
    try {
      process.chdir(root);
      dot = runCli(['guide', '.']);
      bare = runCli(['guide']);
    } finally {
      process.chdir(cwd);
    }
    expect(dot!.exitCode).toBe(0);
    expect(bare!.exitCode).toBe(0);
    expect(existsSync(join(root, AGENT_GUIDE_PATH))).toBe(true);

    const other = makeWorkspace({ 'README.md': '# Other\n' });
    expect(runCli(['guide', other]).exitCode).toBe(0);
    expect(runCli(['guide', other, '--force']).exitCode).toBe(0);
    expect(existsSync(join(other, AGENT_GUIDE_PATH))).toBe(true);
  });

  it('does not start the viewer or scaffold a manifest', () => {
    const root = makeWorkspace({ 'README.md': '# Hi\n' });
    expect(runCli(['guide', root]).exitCode).toBe(0);
    expect(existsSync(join(root, '.a2h/manifest.json'))).toBe(false);
  });
});
