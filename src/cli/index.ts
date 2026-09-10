import { watch } from 'node:fs';
import { resolve } from 'node:path';
import type { Presentation } from '../types';
import { Workspace } from '../server/workspace';
import { createA2hServer, findAssetsDir } from '../server/server';
import { scanWorkspace } from '../scanner/scan';
import { writeStarterManifest } from './init';
import { printValidateReport, validateWorkspace } from './validate';

const VERSION = '0.1.0';
const DEFAULT_PORT = 8420;

interface ParsedArgs {
  command: string;
  path: string;
  watch: boolean;
  open: boolean;
  port?: number;
  force: boolean;
  help: boolean;
  version: boolean;
}

export function main(argv: string[]): void {
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    return;
  }
  if (args.version) {
    console.log(`a2h ${VERSION}`);
    return;
  }

  const rootDir = resolve(args.path || '.');

  if (args.command === 'init') {
    runInit(rootDir, args.force);
    return;
  }

  if (args.command === 'validate') {
    runValidate(rootDir);
    return;
  }

  runRender(rootDir, args);
}

/**
 * `a2h validate` is the one command that reports through its exit code, so a
 * producer can wire it into a check. Warnings are allowed through (exit 0);
 * only a claim that would mislead a human is an error.
 */
function runValidate(rootDir: string): void {
  const report = validateWorkspace(rootDir);
  process.exitCode = printValidateReport(report);
}

function runInit(rootDir: string, force: boolean): void {
  const scan = scanWorkspace({ rootDir });
  const result = writeStarterManifest(scan, force);
  console.log('');
  if (!result.created) {
    console.log(`  Manifest already present: ${result.path}`);
    console.log('  Pass --force to overwrite it.');
    console.log('');
    return;
  }
  console.log(`  Wrote ${result.path}`);
  console.log('');
  console.log('  It already reflects this workspace. Now make it meaningful:');
  console.log('    - set "role" / "group" / "priority" on the items that matter');
  console.log('    - add "tasks" for the work a human should judge');
  console.log('    - add "actions" to give the human something to do about it');
  console.log('    - add "panels" for composed blocks (metrics, tables, timelines)');
  console.log('');
}

function runRender(rootDir: string, args: ParsedArgs): void {
  const workspace = new Workspace({ rootDir });

  printSummary(workspace);

  const { server, broadcast, host } = createA2hServer({
    workspace,
    assetsDir: findAssetsDir(),
  });

  server.on('error', (err: NodeJS.ErrnoException & { port?: number }) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`a2h: port ${err.port} is already in use — try --port <other>`);
    } else {
      console.error(`a2h: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(args.port ?? DEFAULT_PORT, host, () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : args.port ?? DEFAULT_PORT;
    const url = `http://localhost:${port}`;
    console.log('');
    console.log('  Local viewer:');
    console.log(`  ${url}`);
    console.log('');
    if (args.watch) console.log('  Watching for changes… (Ctrl+C to stop)');
    if (workspace.presentation.simulatedActions) {
      console.log('  Actions are simulated: no external agent is connected.');
    }
    console.log('');
    if (args.open) openBrowser(url);
  });

  if (args.watch) {
    setupWatch(rootDir, workspace, broadcast);
  }

  // Keep the process alive and exit cleanly on Ctrl+C.
  process.on('SIGINT', () => {
    console.log('\na2h: shutting down');
    process.exit(0);
  });
}

function setupWatch(rootDir: string, workspace: Workspace, broadcast: (e: string) => void): void {
  let timer: NodeJS.Timeout | undefined;
  try {
    const watcher = watch(rootDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          workspace.rescan();
          broadcast('change');
        } catch (err) {
          console.error('a2h: rescan failed:', (err as Error).message);
        }
      }, 300);
    });
    watcher.on('error', () => {
      /* fall back to no-op; watch is best-effort */
    });
  } catch {
    console.error('a2h: watch mode unavailable on this platform');
  }
}

function printSummary(workspace: Workspace): void {
  const { presentation } = workspace;
  console.log('');
  console.log('A2H scanned this workspace');
  console.log('');

  if (presentation.semantics !== 'inferred') {
    console.log(`  semantics: ${presentation.semantics} (producer manifest)`);
  } else {
    console.log('  semantics: inferred (no manifest — zero-config mode)');
  }

  for (const task of presentation.tasks) {
    console.log(`  task: ${task.title} [${String(task.status)}]`);
  }

  for (const section of presentation.sections) {
    const n = section.artifacts.length;
    const mark = section.explicit ? '•' : ' ';
    console.log(`  ${mark} ${section.title}${n ? ` (${n})` : ''}`);
  }

  if (presentation.actions.length > 0) {
    console.log(
      `  ${presentation.actions.length} action(s)` +
        (presentation.simulatedActions ? ` — ${simulationSummary(presentation, true)}` : ''),
    );
  }
  if (presentation.stats.ignored > 0) {
    console.log(`  ${presentation.stats.ignored} ignored entries`);
  }
  if (presentation.warnings.length > 0) {
    console.log('');
    console.log(`  ${presentation.warnings.length} warning(s) — see the viewer for details`);
  }
}

function openBrowser(url: string): void {
  const { exec } = require('node:child_process') as typeof import('node:child_process');
  const platform = process.platform;
  try {
    if (platform === 'darwin') exec(`open "${url}"`);
    else if (platform === 'win32') exec(`start "" "${url}"`);
    else exec(`xdg-open "${url}"`);
  } catch {
    /* ignore */
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: 'render',
    path: '.',
    watch: false,
    open: false,
    force: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a === '--watch' || a === '-w') args.watch = true;
    else if (a === '--open' || a === '-o') args.open = true;
    else if (a === '--force' || a === '-f') args.force = true;
    else if (a === '--port' || a === '-p') {
      const next = argv[i + 1];
      if (next && /^\d+$/.test(next)) {
        args.port = Number(next);
        i++;
      }
    } else if (a.startsWith('--port=')) {
      const value = a.slice('--port='.length);
      if (/^\d+$/.test(value)) args.port = Number(value);
    } else if (a === 'help') args.help = true;
    else if (a === 'init') args.command = 'init';
    else if (a === 'render') args.command = 'render';
    else if (a === 'validate') args.command = 'validate';
    else if (!a.startsWith('-')) {
      args.path = a;
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
a2h — Agent to Human

Turn an agent workspace into a structured, human-readable local web surface.

Usage:
  a2h [render] [path] [options]
  a2h init <path>
  a2h validate [path]

Commands:
  render   <path>  Scan a workspace and start the local viewer (default)
  init     <path>  Scaffold .a2h/manifest.json from the current workspace
  validate <path>  Check the workspace against the producer protocol
  help             Show this help

Options:
  -w, --watch      Watch the workspace and live-update the viewer on changes
  -p, --port <n>   Port for the local viewer (default ${DEFAULT_PORT})
  -o, --open       Open the viewer in your default browser
  -f, --force      (init) overwrite an existing manifest
  -v, --version    Print the version

Producer protocol:
  A workspace can teach A2H what its content means by shipping
  .a2h/manifest.json (or a2h.json). With no manifest, A2H infers everything
  from conventions and file content — zero-config still works.

  validate exits 1 only when the workspace claims something broken enough to
  mislead a human (invalid manifest, a missing item path, an action id that
  does not resolve, an unreadable decision file). Warnings — unknown roles,
  unused actions, an inferred-only workspace — exit 0.

Examples:
  npx a2h render
  npx a2h render ../a-coding-task --watch
  npx a2h init . && npx a2h validate . && npx a2h render .
`);
}

/**
 * How to describe the simulation state, now that it is a per-action fact.
 *
 * Saying "actions are simulated" when only some of them are would be the exact
 * misstatement the per-action provenance exists to prevent.
 */
function simulationSummary(presentation: Presentation, terse = false): string {
  const simulated = presentation.actions.filter((a) => a.simulated).length;
  if (simulated === presentation.actions.length) {
    return terse
      ? 'simulated by the built-in executor, no external agent connected'
      : 'Actions are simulated: no external agent is connected.';
  }
  return terse
    ? `${simulated}/${presentation.actions.length} simulated by the built-in executor`
    : `${simulated} of ${presentation.actions.length} actions are simulated: no external agent is connected for those.`;
}
