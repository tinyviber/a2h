# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-09-10

Release hygiene. **No change to A2H's behaviour or to its security model.**

0.1.0 was already published, and it already contains the trust-boundary work listed under
it below — that work landed on `main` in `818fd73` and was merged before the 0.1.0 publish
(`6376b6b`). What 0.1.0 did *not* get right was its packaging and its own metadata. This
release corrects that.

### Fixed

- **`--version` can no longer drift from the published version.** The CLI carried its own
  `VERSION` constant next to `package.json`, and the two had already disagreed once in this
  repository's history. The CLI now reads `name` and `version` from the manifest at runtime,
  so `package.json` is the single source of truth and there is no second version to update.

### Added

- `repository`, `homepage`, `bugs`, and `keywords` are now declared. The published 0.1.0
  declared none of them, so npm had nothing to link back to this repository.
- `publishConfig.access` is `public`, stated in the manifest instead of depending on
  `--access public` being passed at publish time.
- `CHANGELOG.md` (this file).

### Changed

- The README's example commands now say that they require **a clone of this repository**,
  run from the repo root. The published tarball ships only `bin` and `dist` (`files` in
  `package.json`), so `examples/` is not present for someone who installed from npm.

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
