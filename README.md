# A2H — Agent to Human

**Turn agent workspaces into human-readable, inspectable, actionable local web interfaces.**

Agents are good at producing files, logs, diffs, reports, intermediate state, and machine-friendly metadata. Humans are not good at supervising all of that through a terminal or by opening folders one file at a time.

A2H is the layer in between:

```text
Agent workspace
      ↓
scan + semantics
      ↓
presentation
      ↓
Human interface
```

It works with an ordinary repository out of the box, and agents can optionally describe richer semantics through a small `.a2h/manifest.json` protocol.

A2H is **not** another agent runtime or workflow engine. It is the human-facing layer for reading, inspecting, comparing, judging, and acting on work produced by agents.

## Quick start

Requires Node.js 18+.

```bash
npx @tinyviber/a2h render . --open
```

A2H scans the current workspace and starts a local viewer on `http://localhost:8420`.

For live updates while an agent is working:

```bash
npx @tinyviber/a2h render . --watch --open
```

No configuration is required.

## Zero-config first

On an ordinary repository, A2H infers a useful presentation from the files already there:

- README and Markdown
- code
- diffs
- logs
- JSON / structured data
- images
- reports and generated artifacts

File names, directory conventions, content type, and lightweight heuristics are used only as fallbacks. Existing repositories do not need to adopt an A2H-specific structure.

## Explicit semantics for agents

When a producer wants more control, it can write `.a2h/manifest.json` and tell A2H what the workspace means.

Start from the current workspace automatically:

```bash
npx @tinyviber/a2h init .
```

A small manifest can look like this:

```json
{
  "a2h": 1,
  "name": "Coding task",
  "tasks": [
    {
      "id": "review",
      "title": "Review implementation",
      "status": "waiting-for-human",
      "actions": ["approve"]
    }
  ],
  "actions": [
    {
      "id": "approve",
      "label": "Approve",
      "kind": "approve",
      "taskId": "review",
      "sideEffect": "state"
    }
  ],
  "items": [
    {
      "path": "review/summary.md",
      "role": "review",
      "taskId": "review",
      "priority": 900
    },
    {
      "path": "patches/change.diff",
      "role": "implementation-diff",
      "taskId": "review"
    }
  ]
}
```

The important separation is:

```text
role         = what this artifact means
content kind = how its bytes should be rendered
```

So a producer may invent roles such as `spec`, `evidence`, `decision`, `signal`, or `publish-candidate` without teaching the renderer new file types.

When signals conflict, A2H prefers explicit semantics and falls back progressively to conventions and inference.

## Tasks, runs, presentation blocks, and actions

The protocol can describe more than files. A workspace can expose:

- tasks and their status
- agent / workflow runs
- artifacts associated with a task or run
- metrics, tables, timelines, comparisons, notices, and other presentation blocks
- human-facing actions such as approve, reject, retry, or send back to an agent

The built-in executor currently **simulates actions by default**. The UI says when an action is simulated. Real agent integrations are intended to sit behind provider / adapter boundaries rather than being hard-coded into A2H.

## Examples

Two example workspaces are included in the repository.

### Radar

A simulated daily agent workflow that ingests sources, clusters signals, writes publish candidates, and stops for human review.

```bash
npx @tinyviber/a2h render examples/radar --open
```

See [`examples/radar`](examples/radar) and its [manifest](examples/radar/.a2h/manifest.json).

### Coding task

A workspace centered on a coding-agent task with a spec, implementation, tests, patch, screenshots, and review decisions.

```bash
npx @tinyviber/a2h render examples/coding-task --open
```

See [`examples/coding-task`](examples/coding-task).

## CLI

```text
npx @tinyviber/a2h [render] [path] [options]
npx @tinyviber/a2h init [path]
```

The package is `@tinyviber/a2h`; installed globally or run through `npx`, it exposes the command `a2h`. The rest of this document uses the `a2h` form for brevity.

Common options:

```text
-w, --watch       Watch the workspace and refresh on changes
-p, --port <n>    Viewer port (default: 8420)
-o, --open        Open the viewer in the default browser
-f, --force       Overwrite an existing manifest when using init
-v, --version     Print the version
```

Examples:

```bash
npx @tinyviber/a2h render
npx @tinyviber/a2h render ../agent-workspace --watch
npx @tinyviber/a2h init .
npx @tinyviber/a2h render . --port 9000 --open
```

## Design principles

A2H is deliberately local-first and content-first.

The interface is designed for humans to:

**read → inspect → compare → judge → act when necessary**

The semantic layer is designed for machines to emit structured meaning without coupling themselves to a specific frontend.

The zero-config path remains important: explicit metadata should improve a workspace, not become a requirement for using A2H.

## Security model

A2H treats the workspace as untrusted input.

Workspace file reads go through a bounded capability that checks the scanner allowlist, sensitive-file classification, symlinks, and real-path containment. Raw workspace files are not exposed as arbitrary same-origin documents.

Mutating browser requests go through a separate control-surface boundary. Actions must be declared, browser parameters are filtered against the declared schema, external effects require confirmation, and localhost mutations require a per-process session token.

The server binds to `127.0.0.1` by default.

## Development

```bash
npm install
npm run build
npm test
npm run test:acceptance
```

Run the CLI from the repository:

```bash
node bin/a2h.js render examples/radar --open
```

Before publishing:

```bash
npm pack
npm publish --dry-run
```

## Status

A2H is early-stage. The protocol and presentation model are intentionally small and extensible, and real external agent providers are still evolving.

If you are experimenting with coding agents, scheduled agents, research pipelines, or any workflow where machines produce more state than a human wants to inspect manually, A2H is meant to be a thin human interface over that work.

## License

MIT
