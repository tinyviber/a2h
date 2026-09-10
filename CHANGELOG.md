# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-09-10

The trust-boundary release. The behaviour below landed on `main` while 0.1.0 was still
unpublished (`818fd73`, merged as `755499a`); this release is the first to ship it, under
the scoped package name `@tinyviber/a2h`, with CI that makes its test counts checkable
rather than self-reported.

### Changed

- **Package renamed `a2h` → `@tinyviber/a2h`.** The installed command is unchanged: `a2h`.
  Protocol identifiers are deliberately untouched — `.a2h/`, `a2h.json`, the `"a2h": 1`
  manifest field, and the `x-a2h-token` header mean exactly what they meant in 0.1.0.
- `publishConfig.access` is `public`. A scoped package defaults to restricted, which makes
  `npm publish` fail rather than publish the wrong thing.
- The `--version` output now names the package (`@tinyviber/a2h 0.2.0`) rather than the
  bare command.

### Security

- **An action's danger level is no longer the workspace's to declare.**
  `ActionExecutor.policy(action): EffectPolicy` is now a required part of the provider
  seam, and the engine merges it with the manifest's `sideEffect` + `confirm` hint, taking
  the stricter of the two. A workspace may raise `state → external`; it can no longer lower
  `external → state`. "An effect that leaves this machine requires confirmation" is
  normalized inside `src/actions/policy.ts`, so no call site — including the hint-only path
  with no provider registered — can skip it. `ProviderRegistry.resolve(action)` answers
  "who runs this, is it real, what may it do" in one place.
- **`simulated` is a per-action fact, not a registry-global one.** Previously a single real
  executor made *every* action read as real, including the ones still routed to the
  built-in simulator. Simulation provenance is now resolved per action, and the engine
  reports a run as simulated if either the resolution or the executor says so — the two
  sources can only disagree in the conservative direction.
- **List block `href` is restricted to `http:`, `https:`, `mailto:`, `#`, and
  workspace-relative paths** — the same allowlist the Markdown renderer validates against,
  from one shared module (`src/security/urlPolicy.ts`). `javascript:`, `data:`, `file:`,
  `vbscript:` and protocol-relative targets are refused at the server boundary and again on
  the way to the DOM, rather than relying on the page's CSP as a second line of defence.

### Fixed

- An explicit producer group and an inferred section can no longer end up sharing an id.
  Sections with the same id are merged, with the producer's node keeping the id, the title
  and the position, and a warning naming the shadowed id. Previously the router's `find()`
  could only ever reach one of the two, so the human saw a section they could not open.

### Added

- `.github/workflows/ci.yml` — `tsc` build, the unit suite, and browser acceptance across
  three workspace profiles (`mixed`, `radar`, `coding`), with screenshots uploaded on
  failure.

## [0.1.0] — 2026-09-10

### Added

- First release: workspace scanner, semantic IR, presentation layer, local viewer,
  the `.a2h/manifest.json` producer protocol, tasks / runs / presentation blocks /
  human actions, and the provider seam backed by a built-in simulator.
