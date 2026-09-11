# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

A2H already did Agent → Human: a manifest, artifacts, and a renderer. This adds the
other direction, A2H → Agent, and closes two gaps that let a workspace make a promise
the viewer could not keep.

No change to the trust-boundary model. The policy merge, the shared URL allowlist, and
the localhost mutation guard are untouched; so is the ordering inside `workspaceRead`.

### Added

- **`a2h guide [path]`.** Writes `.a2h/agent-guide.md`: project-aware producer guidance
  for the coding agent that produces work in a workspace. It is deterministic, offline,
  and idempotent — two runs over an unchanged workspace are byte-identical — and it
  contains no file bodies and no file listing, only the coarse shape of the repository
  (traits, dominant languages, the directory conventions that actually matched).
  `a2h guide` does not start the viewer and does not run `init`.
- **A safe writer for generated workspace files** (`writeWorkspaceFile`), used by
  `guide` and available to future manifest and run writers. It refuses a destination
  outside the workspace, refuses any symlinked path component, refuses non-regular
  files, writes through a temp file in the same directory plus an atomic rename, and
  leaves no temp behind on failure. Overwriting a file requires either the generation
  marker or `--force`, so a user's own file is never silently replaced.

### Changed

- **`a2h validate` now checks every path a workspace claims a human can read**, not
  just `items[].path`: task artifacts, run artifacts (from the manifest or from
  `.a2h/runs/`), and the `path` of a markdown block on a panel, a task, a run, or an
  item. Each is checked against the same reader the viewer uses, so `validate`
  passing means the viewer can actually read it — symlinks, sensitive files, and
  paths that leave the workspace are errors. `action.target`, `relation.target`, and
  list `href` are labels, not file references, and are deliberately not checked.
- `a2h --help` lists `guide`, and states the widened path claims for `validate`.

### Fixed

- **The decision writer is now the authority for the record's protocol version.**
  `writeDecisionRecord` spread the caller's record over its own `a2h: 1`, so a caller
  that passed its own version relabelled the file. The spread now happens first and the
  version is forced after it, so every record on disk is stamped `"a2h": 1` — the
  protocol version of the directory, not of whoever wrote the file.

## [0.1.1] — 2026-09-10

Packaging hygiene and the producer contract, in one release.

**No change to the trust-boundary model.** The policy merge, the shared URL allowlist, and
the localhost mutation guard are exactly as they shipped in 0.1.0; nothing here relaxes or
rewrites them. The durable decision records added below are an audit trail, not an input —
they are never consulted when deciding whether an action may run.

0.1.0 was already published, and it already contains the trust-boundary work listed under
it below — that work landed on `main` in `818fd73` and was merged before the 0.1.0 publish
(`6376b6b`). What 0.1.0 did *not* get right was its packaging and its own metadata. This
release corrects that, and writes down the producer contract that was previously implicit.

### Added

- **The producer protocol, written down.** `docs/protocol.md` is the normative field
  reference: canonical files, field-level merge precedence, roles versus content kinds, the
  `sideEffect` hint, decision records, failure modes, and the prohibited list.
- **An agent skill.** `docs/agent-skill.md` states the same contract as instructions to an
  agent, with a drop-in copy at `examples/agent-skill/SKILL.md` for an agent runner's skill
  directory.
- **`a2h validate [path]`.** A pre-flight check a producer can wire into a gate. It exits 1
  only when a claim would mislead a human — an unusable manifest, a missing item path, an
  unknown action id, or a decision file A2H refused to read — and exits 0 with warnings for
  a workspace that is merely thin (no manifest, no tasks, producer-defined roles, unused
  actions).
- **Durable decision records.** Every action attempt, success or refusal, is written to
  `.a2h/decisions/<utc>-<actionId>.json`, so the fact that a human approved something
  survives a viewer restart. Reads use the same containment, no-follow, and byte-cap rules
  as the manifest; the record is an audit trail and never grants authority.
- `repository`, `homepage`, `bugs`, and `keywords` are now declared. The published 0.1.0
  declared none of them, so npm had nothing to link back to this repository.
- `publishConfig.access` is `public`, stated in the manifest instead of depending on
  `--access public` being passed at publish time.
- `CHANGELOG.md` (this file).

### Changed

- The README's example commands now say that they require **a clone of this repository**,
  run from the repo root. The published tarball ships only `bin` and `dist` (`files` in
  `package.json`), so `examples/` is not present for someone who installed from npm.
- Published invocations are written `npx @tinyviber/a2h …`; because the package is scoped,
  `npx` cannot resolve it by the short command name. The command the package installs is
  still `a2h`.
- In the viewer, the audit heading reads "Action audit" rather than "Session audit", and
  its copy no longer claims that nothing is written to disk — decisions are.

### Fixed

- **`--version` can no longer drift from the published version.** The CLI carried its own
  `VERSION` constant next to `package.json`, and the two had already disagreed once in this
  repository's history. The CLI now reads `name` and `version` from the manifest at runtime,
  so `package.json` is the single source of truth and there is no second version to update.

## [0.1.0] — 2026-09-10

First release, published as `@tinyviber/a2h`. The package name is scoped; the command it
installs is still `a2h`.

### Added

- Workspace scanner, semantic IR, presentation layer, and the local viewer.
- The `.a2h/manifest.json` producer protocol: tasks, agent runs, artifacts, presentation
  blocks, and human-facing actions such as approve, reject, or send back to an agent.
- The provider seam, backed by a built-in simulator.
- `.github/workflows/ci.yml` — `tsc` build, the unit suite, and browser acceptance across
  three workspace profiles (`mixed`, `radar`, `coding`).

### Security

The trust-boundary behaviour below is **already part of 0.1.0**. It landed on `main` in
`818fd73` (merged as `755499a`), before 0.1.0 was published from `6376b6b`. It is recorded
under 0.1.0 because that is the version which ships it.

- **An action's danger level is no longer the workspace's to declare.**
  `ActionExecutor.policy(action): EffectPolicy` is a required part of the provider seam, and
  the engine merges it with the manifest's `sideEffect` + `confirm` hint, taking the stricter
  of the two. A workspace may raise `state → external`; it can no longer lower
  `external → state`. "An effect that leaves this machine requires confirmation" is
  normalized inside `src/actions/policy.ts`, so no call site — including the hint-only path
  with no provider registered — can skip it.
- **`simulated` is a per-action fact, not a registry-global one.** Previously a single real
  executor made *every* action read as real, including those still routed to the built-in
  simulator. Provenance is now resolved per action through
  `ProviderRegistry.resolve(action)`, and a run is reported as simulated if either the
  resolution or the executor says so — the two can only disagree in the conservative
  direction.
- **List block `href` is restricted to `http:`, `https:`, `mailto:`, `#`, and
  workspace-relative paths**, validated against one shared allowlist
  (`src/security/urlPolicy.ts`) that the Markdown renderer uses as well. `javascript:`,
  `data:`, `file:`, `vbscript:` and protocol-relative targets are refused at the server
  boundary and again on the way to the DOM, rather than relying on the page's CSP as a
  second line of defence.

### Fixed

- An explicit producer group and an inferred section can no longer end up sharing an id.
  Sections with the same id are merged, with the producer's node keeping the id, the title,
  and the position, and a warning naming the shadowed id. Previously the router's `find()`
  could only ever reach one of the two, so the human saw a section they could not open.
