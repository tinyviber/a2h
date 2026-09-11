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

### For agents

If you are the agent writing the workspace, the normative field reference is
[`docs/protocol.md`](docs/protocol.md). [`docs/agent-skill.md`](docs/agent-skill.md)
covers the same ground as instructions — when to run `a2h init`, when to record
a run, how to ask a human for a decision, and how to read `.a2h/decisions/`
afterwards. A copy an agent runner can drop in place is at
[`examples/agent-skill/SKILL.md`](examples/agent-skill/SKILL.md). If the
repository ships `.a2h/agent-guide.md`, read that first: it is guidance
generated for this specific project by `a2h guide`.

Check a workspace before showing it to anyone:

```bash
npx @tinyviber/a2h validate .
```

## Guide the producing agent

A2H also runs in the other direction. `a2h guide` writes `.a2h/agent-guide.md`:
project-aware instructions for the coding agent that produces work here — which
conventions are in use, whether this reads as a data repository or a code
repository, how to materialize a bounded view over a corpus, and the producer
contract in one page.

```bash
npx @tinyviber/a2h guide .
```

The file is deterministic and offline: run it twice over an unchanged workspace
and you get identical bytes. It carries a machine marker, so regenerating it is
safe; a file that does not carry that marker is left alone unless you pass
`--force`.

**A2H does not write `AGENTS.md`.** The guide is guidance for the agent, not
protocol input, and it is never rendered as workspace content. The project's own
agent reads it and decides whether to merge durable rules into `AGENTS.md`.

A typical order, if you want a project prepared end to end — no project is
required to do all of it:

```text
guide → init → validate → render
```

## Tasks, runs, presentation blocks, and actions

The protocol can describe more than files. A workspace can expose:

- tasks and their status
- agent / workflow runs
- artifacts associated with a task or run
- metrics, tables, timelines, comparisons, notices, and other presentation blocks
- human-facing actions such as approve, reject, retry, or send back to an agent

The built-in executor currently **simulates actions by default**. The UI says when an action is simulated. Real agent integrations are intended to sit behind provider / adapter boundaries rather than being hard-coded into A2H.

## Examples

Two example workspaces are included in the repository. The commands below are meant to be
run **from a clone of this repository**, with the repo root as the working directory: the
published npm package ships only `bin` and `dist`, so `examples/` is not present in an
`npx` install.

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
npx @tinyviber/a2h guide [path]
npx @tinyviber/a2h validate [path]
```

The package is `@tinyviber/a2h`; installed globally or run through `npx`, it exposes the command `a2h`. Every invocation below names the package in full — because the package is scoped, `npx` cannot resolve it by the short command name. The CLI's own `--help` keeps the short `a2h` name for its usage lines.

Common options:

```text
-w, --watch       Watch the workspace and refresh on changes
-p, --port <n>    Viewer port (default: 8420)
-o, --open        Open the viewer in the default browser
-f, --force       Overwrite an existing file (init, guide)
-v, --version     Print the version
```

Examples:

```bash
npx @tinyviber/a2h render
npx @tinyviber/a2h render ../agent-workspace --watch
npx @tinyviber/a2h init .
npx @tinyviber/a2h guide .
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
