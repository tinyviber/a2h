import { watch } from 'node:fs';
import { resolve } from 'node:path';
import { Workspace } from '../server/workspace';
import { createA2hServer, findAssetsDir } from '../server/server';

const VERSION = '0.1.0';
const DEFAULT_PORT = 8420;

interface ParsedArgs {
  command: string;
  path: string;
  watch: boolean;
  open: boolean;
  port?: number;
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
  if (args.command === 'init') {
    console.log('a2h init — not implemented yet. The first version is zero-config; run `npx a2h render`.');
    return;
  }

  const rootDir = resolve(args.path || '.');
  const workspace = new Workspace(rootDir);

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
  let watcher;
  try {
    watcher = watch(rootDir, { recursive: true }, (_event, filename) => {
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
  for (const section of presentation.sections) {
    const n = section.artifacts.length;
    console.log(`  ${section.title}${n ? ` (${n})` : ''}`);
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
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a === '--watch' || a === '-w') args.watch = true;
    else if (a === '--open' || a === '-o') args.open = true;
    else if (a === '--port' || a === '-p') {
      const next = argv[i + 1];
      if (next && /^\d+$/.test(next)) {
        args.port = Number(next);
        i++;
      }
    } else if (a === 'help') args.help = true;
    else if (a === 'init') args.command = 'init';
    else if (a === 'render') args.command = 'render';
    else if (!a.startsWith('-')) {
      args.path = a;
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
a2h — Agent to Human

Turn a messy agent workspace into a structured, human-readable local web view.

Usage:
  a2h [render] [path] [options]

Commands:
  render <path>    Scan a workspace and start the local viewer (default command)
  init             Generate an a2h.config.ts (not yet implemented)
  help             Show this help

Options:
  -w, --watch      Watch the workspace and live-update the viewer on changes
  -p, --port <n>   Port for the local viewer (default ${DEFAULT_PORT})
  -o, --open       Open the viewer in your default browser
  -v, --version    Print the version

Examples:
  npx a2h render
  npx a2h render .
  npx a2h render ../another-project --watch
`);
}
