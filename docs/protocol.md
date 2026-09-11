# A2H producer protocol

Normative. This is what a producer (an agent, a workflow runner, a script, a
human) writes so that A2H does not have to guess what a workspace means.

A2H is a human-facing compiler over an untrusted workspace. The durable
contract is **files on disk**. There is no API to call, no server to register
with, and no plugin to install: you write files, A2H reads them.

Everything here is optional. With no protocol files at all, `a2h render` still
produces a useful presentation from conventions and file content.

---

## 1. Canonical files

| Path | Purpose |
| --- | --- |
| `.a2h/manifest.json` | The workspace's semantics: name, groups, tasks, runs, actions, items, panels. |
| `a2h.json` | Alias for the manifest. `.a2h/manifest.json` wins if both exist. |
| `.a2h/runs/*.json` | One run record per file, so an append-only producer never rewrites the manifest. |
| `.a2h/decisions/*.json` | The action trail written by A2H when a human acts. See §7. |

`.a2h/` is a protocol directory. It is consumed as semantics and is never
rendered as workspace content.

The protocol version lives in the document itself:

```json
{ "a2h": 1 }
```

`a2h` is optional. **Absent means 1.** A document that declares a version other
than 1 is read as version 1 and produces a warning — the protocol is additive,
so an unknown version is not an error.

### `.a2h/agent-guide.md`

Not protocol input. `a2h guide` writes this file as project-aware guidance for
the agent that *produces* work in a workspace — the agent may merge durable
rules from it into its own `AGENTS.md`. It is tooling-generated, it has no
authority in the merge precedence below, and it is never rendered as workspace
content. A2H does not read it as semantics, and A2H never writes or edits
`AGENTS.md`.

## 2. Merge precedence

Precedence is **field-level**, not document-level, and a later source only
fills fields an earlier source left empty. The order, strongest first:

```text
explicit manifest   >   frontmatter a2h_*   >   convention   >   heuristic   >   extension
```

So a manifest item that declares only `priority` still lets frontmatter supply
`group` and `summary`, and a convention-derived placement survives if nobody
claims the artifact.

Frontmatter keys are prefixed so they cannot collide with prose. The recognised
ones are `a2h_role`, `a2h_title`, `a2h_summary`, `a2h_group`, `a2h_task`,
`a2h_status`, `a2h_priority`, `a2h_tags` (comma-separated), and `a2h_hidden`.
They apply to the Markdown file they appear in. `a2h_status` is parsed but
currently has no effect on the presentation layer — use the manifest for
anything that must be true.

`a2h validate` warns when the whole workspace fell through to conventions with
no manifest at all.

## 3. Role vs content kind

Two independent facts about an artifact, and they must not be conflated:

```text
role          what this artifact means          producer-defined, open string
content kind  how its bytes should be rendered derived from the file, not the role
```

You may invent roles freely — `spec`, `evidence`, `signal`, `draft`,
`publish-candidate`, anything. A2H treats an unrecognised role as an opaque
label and draws the artifact from its **content kind**, so a PNG called
`final-truth` is still an image and a Markdown file called `dataset` is still
read as Markdown.

The built-in roles (`readme`, `markdown`, `report`, `code`, `json`, `log`,
`diff`, `image`, `file`) only earn a default placement and styling. They are
not a closed set and no producer is required to use them.

## 4. Field reference

The authoritative field lists are the TypeScript interfaces in
[`src/semantics/types.ts`](../src/semantics/types.ts). All of them are
optional except the ids noted below; unknown fields are ignored.

**Top level** — `a2h`, `name`, `summary`, `groups`, `tasks`, `runs`, `actions`,
`items`, `panels`.

**`groups[]`** — `id` (required), `title`, `description`, `order`, `taskId`.
A group is a producer-chosen section for related artifacts.

**`items[]`** — `path` (required, workspace-relative), `role`, `title`,
`summary`, `group`, `taskId`, `priority` (higher sorts earlier), `tags`,
`hidden`, `relations`, `metrics`, `blocks`.

**`tasks[]`** — `id` (required), `title`, `status`, `summary`, `group`,
`owner`, `updatedAt`, `progress`, `metrics`, `blocks`, `actions` (action ids),
`artifacts` (workspace-relative paths).

**`runs[]`** — `id` (required), `taskId`, `title`, `status`, `startedAt`,
`endedAt`, `durationMs`, `summary`, `artifacts`, `steps`, `blocks`. A file in
`.a2h/runs/` may hold one run, an array of runs, or `{ "runs": [...] }`.

**`actions[]`** — `id` and `label` (required), `kind`, `taskId`, `target`,
`description`, `sideEffect`, `confirm`, `params`, `enabled`. See §6.

**`params[]`** — `name` (required), `label`, `type`
(`text` | `textarea` | `select` | `boolean`), `required`, `options`,
`placeholder`, `default`.

**`blocks[]`** — any object with a string `type`. The renderer knows `text`,
`markdown`, `notice`, `list`, `table`, `comparison`, `metrics`, `timeline`,
`status`, `keyvalue`, and `actions`. An unknown `type` renders as an
inspectable fallback rather than an error, so a producer may target a newer
viewer than the one reading it.

Do not invent fields outside these lists. If the protocol seems to be missing
something, that is a protocol change, not a producer-side extension.

## 5. Status strings are open

`status` is a free string, on tasks, runs, steps, and timeline items. A2H
recognises some (`pending`, `running`, `succeeded`, `failed`, `partial`,
`blocked`, `cancelled`, `info`) and gives them a tone; anything else renders
with a neutral treatment.

There is no enum to satisfy and no value is rejected. Do not assume a status
string will be interpreted — choose one a human reads correctly.

## 6. `sideEffect` is a hint

For an action, `sideEffect` may be `none`, `state`, or `external`. It defaults
to `state`. It is a **hint from untrusted input**, not a security setting.

The authoritative statement is the executor's own policy, and the two are
merged monotonically: **the workspace may raise the effective severity, never
lower it.** An `external` effect always requires confirmation, whatever the
manifest says.

State this in the workspace, and do not try to outsmart it:

- declaring `"sideEffect": "none"` on something that leaves the machine does
  not make it safe — a real executor will report its own policy and the merge
  takes the stricter one;
- declaring `"confirm": false` on an external action is ignored.

A2H's executor policy is authoritative. Producers describe intent; they do not
implement policy.

## 7. Decision records

When a human acts through the viewer, A2H writes one record per attempt —
successes and refusals alike — to:

```text
.a2h/decisions/<utc>-<actionId>.json
```

```json
{
  "a2h": 1,
  "at": "2026-09-10T09:41:00.000Z",
  "actionId": "approve-draft",
  "kind": "approve",
  "sideEffect": "external",
  "ok": true,
  "simulated": true,
  "message": "Approved. A downstream agent would now pick this up.",
  "executor": "mock",
  "params": { "draft": "draft-01-lattice-pricing.md" },
  "taskId": "review-candidates"
}
```

`params` holds only the keys the action declared and the values the executor
actually received; undeclared browser input is dropped before the file is
written. `params` is absent when the attempt never reached an executor.

Two rules about this directory:

1. **It is an audit trail, not an input.** A2H reads it to show what happened.
   It is never consulted when deciding whether an action may run, so writing a
   decision file cannot grant authority or waive a confirmation.
2. **It is written by A2H, not by you.** Producers may read it. Do not write
   it unless you are deliberately fabricating an audit trail, which no
   producer should need to do.

The directory being absent is normal and means "nothing has been decided here".

## 8. Failure mode

A2H never crashes on a broken workspace, and never silently pretends a broken
claim is fine.

- An invalid, partial, or unreadable manifest degrades to **warnings plus
  inference**. The viewer still opens and zero-config reading still works.
- Unknown fields, unknown statuses, and unknown block types are ignored or
  rendered with a fallback.
- A claimed path that A2H cannot show — a missing item path, a missing task or
  run artifact, a markdown block whose file is not there, a symlink, or a
  sensitive file — a task referencing an unknown action, and a decision file
  A2H refused to read are all reported by `a2h validate` as errors.

## 9. Asking a human for something

To request a human decision, a producer MUST:

1. put a task into a waiting- or blocked-style `status` (for example
   `waiting-for-human`, `blocked`);
2. point `artifacts` at the files the human should read, and set `priority` so
   they come first;
3. declare the `actions` the human may take, with a `label` that names the
   decision rather than the mechanism.

An agent that produced work and then simply stopped has not asked for a
decision. A task with no status, no artifacts, and no actions is invisible.

## 10. Prohibited

A producer MUST NOT:

- embed HTML or JavaScript in any field. A2H renders Markdown conservatively
  and does not execute author content;
- point any `path` outside the workspace. Absolute paths, `..`, and escaping
  symlinks are refused;
- present a secret or credential as a previewable artifact. Sensitive files
  are classified and withheld regardless of what the manifest says;
- declare an `external` effect as `none` and expect A2H to believe it (§6).

## 11. Checking your work

```bash
a2h validate .
```

Exit code 0 means the workspace is presentable (warnings are allowed). Exit
code 1 means it claims something broken enough to mislead a human: an unusable
manifest, a claimed path that is missing or that A2H will not render — a missing
item path, a task or run artifact, or a markdown block's file — an action id
that does not resolve, or a decision file A2H refused to read.

`action.target` and `relation.target` are labels, not file references: they are
not checked, and a relation target may name a node rather than a path.

Run it after editing. Fix the errors; read the warnings.

## 12. Minimal manifest

```json
{
  "a2h": 1,
  "name": "Rate limiter task",
  "tasks": [
    {
      "id": "review",
      "title": "Review the change",
      "status": "blocked",
      "actions": ["approve"],
      "artifacts": ["spec.md", "patches/limiter.diff"]
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
    { "path": "spec.md", "role": "spec", "taskId": "review", "priority": 700 },
    { "path": "patches/limiter.diff", "role": "diff", "taskId": "review", "priority": 640 }
  ]
}
```

That is the whole contract in one file: what the work is, what a human should
read and in what order, and what they may do about it.

For a fuller worked example — groups, runs, params, panels, relations, metrics
— see [`examples/radar/.a2h/manifest.json`](../examples/radar/.a2h/manifest.json)
and [`examples/coding-task/.a2h/manifest.json`](../examples/coding-task/.a2h/manifest.json).

For the same material written as instructions to an agent, see
[`agent-skill.md`](agent-skill.md).
