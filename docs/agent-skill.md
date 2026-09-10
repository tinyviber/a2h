# A2H — agent skill

A2H turns this directory into a local web page a human can read, inspect, and
act on. It reads files; it has no API and nothing to call. **The durable
contract is the files you write.** Everything you want a human to see, judge,
or decide has to exist on disk.

You are the producer. This file tells you when to write and what to write. The
full field reference is [`protocol.md`](protocol.md).

---

## When to act

### Starting work in a directory a human will look at

1. If `.a2h/manifest.json` is missing, run `a2h init .`. It scaffolds a valid
   manifest that already reflects the real files in the directory.
2. Then **edit meaning into it**. The scaffold's roles come from file names and
   are a starting point, not an answer. Give the items that matter a real
   `role`, a `group`, and a `priority`. Add the `tasks` a human should judge
   and the `actions` they may take.
3. Do not leave the scaffold as the final truth. A directory of
   `role: "markdown"` has told the human nothing.

### After a meaningful unit of work

Append a run so the work is legible as a sequence rather than a pile:

- drop one JSON file under `.a2h/runs/` (for example
  `.a2h/runs/2026-09-10-implement.json`), or add to `runs` in the manifest;
- set `id`, `title`, `status`, `startedAt` / `endedAt`, and a one-line
  `summary`;
- put every path the run produced in `artifacts`;
- use `steps[]` for what happened, including the step that failed. A run that
  hides its failure is worse than no run.

Use one file per run when you can: it appends without rewriting the manifest,
and it cannot corrupt earlier records.

### When the human must judge

This is the important one. Stopping is not asking.

1. Set the task `status` to a waiting- or blocked-style value
   (`"waiting-for-human"`, `"blocked"`).
2. List what they should read in `artifacts`, and set `priority` so the
   reading order is the order you want. Higher priority sorts earlier.
3. Declare the `actions` they may take — typically approve / reject / retry /
   send-back — each with a `label` that names the decision, not the mechanism.
   Give an action `params` when the decision needs a value (a note, a draft, a
   reason).
4. If the effect would leave the machine, mark it `"sideEffect": "external"`.
   A2H requires confirmation for those regardless; saying so keeps you honest.

### Continuing after a human decision

Read `.a2h/decisions/` before doing more work. One file per attempt is written
there after a human acts, newest first by filename.

Do not assume anything about in-memory UI state. A decision that is not in
`.a2h/decisions/` did not happen as far as your next run is concerned, and a
decision that is there happened even if you never saw the page. Read the
records, then act on what they say.

---

## How to write

- **Edit the JSON files directly.** Do not ask A2H to render HTML for you, and
  do not try to drive a UI. `a2h render` is for the human.
- **Role = meaning, filename/extension = rendering.** Invent roles freely
  (`spec`, `evidence`, `signal`, `draft`) — A2H draws bytes by content kind, so
  the role never has to match a file type it knows.
- **Never write secrets into previewable artifacts.** Credentials, tokens, and
  private keys do not belong in a workspace a human is about to open, and A2H
  will withhold anything it classifies as sensitive anyway.
- **Never embed HTML or JavaScript.** It will not be executed.
- **Keep paths inside the workspace.** Relative paths only.
- **Be specific in `summary`.** "Clustering finished, 3 drafts written, publish
  blocked on review" beats "done".
- **After editing, run `a2h validate .`** and fix the errors and the warnings
  you caused.
  - Exit **1** means a claim that would mislead a human: an unusable manifest,
    a missing item path, an unknown action id, or a decision file A2H refused
    to read.
  - Exit **0** means the workspace is presentable. Warnings — no manifest, no
    tasks, custom roles, unused actions — are allowed and still exit 0.

## The smallest useful manifest

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
    { "id": "approve", "label": "Approve", "kind": "approve", "taskId": "review", "sideEffect": "state" }
  ],
  "items": [
    { "path": "spec.md", "role": "spec", "taskId": "review", "priority": 700 },
    { "path": "patches/limiter.diff", "role": "diff", "taskId": "review", "priority": 640 }
  ]
}
```

Write this much even when the work is small. A task with no status, no
artifacts, and no actions is invisible to the human.

## Commands

```bash
a2h init .        # scaffold .a2h/manifest.json from the current files
a2h validate .    # exit 1 if a claim would mislead a human; warnings exit 0
a2h render .      # what the human runs — not your job
```

## Do not

- Do not declare an effect `"none"` or `"state"` hoping A2H will not notice
  that it leaves the machine. `sideEffect` is a hint; the executor's policy
  wins and the stricter of the two applies.
- Do not write `.a2h/decisions/` yourself. It is an audit trail, and a forged
  one grants no authority anyway.
- Do not point at paths outside the workspace, or at files you never created.
- Do not leave a broken manifest behind. If A2H cannot parse it, every claim in
  it is lost and the workspace falls back to guessing.

---

Full spec: [`protocol.md`](protocol.md).
Worked examples: `examples/radar`, `examples/coding-task`.
