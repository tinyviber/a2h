import type {
  ActionView,
  Block,
  EffectPolicy,
  RunView,
  SemanticsOrigin,
  TaskView,
  TaskStatus,
} from '../types';
import type { GroupSpec, LoadedSemantics, ResolvedItem } from './types';
import { policyFromHint, stricterPolicy } from '../actions/policy';

// Merges producer-authored semantics into a single resolved view.
//
// Precedence, strongest first:
//   explicit manifest item  >  markdown frontmatter  >  heuristics (later layers)
// Field level, not record level: a manifest item that only sets `priority`
// still lets frontmatter supply `group` and `summary`.

export interface ResolvedSemantics {
  origin: SemanticsOrigin;
  name?: string;
  summary?: string;
  items: Map<string, ResolvedItem>;
  groups: GroupSpec[];
  tasks: TaskView[];
  runs: RunView[];
  actions: ActionView[];
  panels?: Block[];
  warnings: string[];
}

/**
 * The provider layer's answer for one action. Structurally satisfied by
 * `ActionResolution`, but stated without the executor so this module does not
 * have to know what a provider is.
 */
export interface ActionProvenance {
  simulated: boolean;
  policy: EffectPolicy;
}

export type ActionResolver = (action: ActionView) => ActionProvenance | undefined;

export interface ResolveOptions {
  /**
   * Who will run each declared action, and what their executor says it will
   * do. Supplied by the assembler, which is the only layer that knows the
   * registered providers.
   *
   * Absent means "no provider can be named", and the safe reading of that is
   * `simulated: true` — claiming a real effect is the claim that can mislead.
   */
  resolveAction?: ActionResolver;
}

export function resolveSemantics(
  loaded: LoadedSemantics,
  options: ResolveOptions,
): ResolvedSemantics {
  const items = new Map<string, ResolvedItem>();
  const warnings = [...loaded.warnings];

  // 1) Manifest items (most explicit).
  for (const spec of loaded.itemSpecs) {
    const key = normalize(spec.path);
    if (!key) continue;
    const existing = items.get(key);
    const next: ResolvedItem = {
      role: spec.role ?? existing?.role,
      title: spec.title ?? existing?.title,
      summary: spec.summary ?? existing?.summary,
      group: spec.group ?? existing?.group,
      taskId: spec.taskId ?? existing?.taskId,
      priority: spec.priority ?? existing?.priority,
      tags: spec.tags ?? existing?.tags,
      hidden: spec.hidden ?? existing?.hidden,
      relations: spec.relations ?? existing?.relations,
      metrics: spec.metrics ?? existing?.metrics,
      blocks: spec.blocks ?? existing?.blocks,
      source: 'explicit',
    };
    items.set(key, next);
  }

  // 2) Frontmatter fills whatever the manifest left open.
  for (const [path, fm] of loaded.frontmatter) {
    const key = normalize(path);
    if (!key) continue;
    const existing = items.get(key);
    const next: ResolvedItem = {
      role: existing?.role ?? fm.role,
      title: existing?.title ?? fm.title,
      summary: existing?.summary ?? fm.summary,
      group: existing?.group ?? fm.group,
      taskId: existing?.taskId ?? fm.taskId,
      priority: existing?.priority ?? fm.priority,
      tags: existing?.tags ?? fm.tags,
      hidden: existing?.hidden ?? fm.hidden,
      relations: existing?.relations,
      metrics: existing?.metrics,
      blocks: existing?.blocks,
      source: existing?.source ?? 'frontmatter',
    };
    items.set(key, next);
  }

  const actions = loaded.actionSpecs.map((a) => toActionView(a, options.resolveAction));
  const actionById = new Map(actions.map((a) => [a.id, a]));

  const runs = dedupeRuns(loaded.runSpecs).map(toRunView);

  const tasks: TaskView[] = loaded.taskSpecs.map((t) => {
    const attached = new Set<string>(t.actions ?? []);
    for (const a of actions) if (a.taskId === t.id) attached.add(a.id);
    return {
      id: t.id,
      title: t.title ?? t.id,
      status: normalizeStatus(t.status),
      summary: t.summary,
      group: t.group,
      owner: t.owner,
      updatedAt: t.updatedAt,
      progress: t.progress,
      metrics: t.metrics,
      blocks: t.blocks,
      artifacts: [...(t.artifacts ?? [])],
      runs: runs.filter((r) => r.taskId === t.id),
      actions: [...attached].map((id) => actionById.get(id)).filter(isPresent),
      source: 'explicit',
    };
  });

  const origin: SemanticsOrigin = loaded.manifest
    ? tasks.length || items.size || loaded.groupSpecs.length
      ? 'explicit'
      : 'mixed'
    : items.size || runs.length
      ? 'mixed'
      : 'inferred';

  if (actions.length > 0) {
    const simulated = actions.filter((a) => a.simulated).length;
    if (simulated === actions.length) {
      warnings.push(
        `${simulated} action(s) are backed by the built-in simulator — no external agent is connected.`,
      );
    } else if (simulated > 0) {
      warnings.push(
        `${simulated} of ${actions.length} action(s) fall through to the built-in simulator; the rest are handled by a connected provider.`,
      );
    }
  }

  return {
    origin,
    name: loaded.name,
    summary: loaded.summary,
    items,
    groups: sortGroups(loaded.groupSpecs),
    tasks,
    runs,
    actions,
    panels: loaded.panels,
    warnings,
  };
}

// ---------------------------------------------------------------------------

/**
 * Builds the client-facing action view.
 *
 * The workspace's declaration is a hint; the executor's policy is
 * authoritative; the effective value is the stricter of the two. Doing the
 * merge here (rather than trusting the manifest's own `sideEffect`/`confirm`)
 * is what stops a workspace from labelling a publish as a no-op.
 */
function toActionView(
  spec: import('./types').ActionSpec,
  resolve: ActionResolver | undefined,
): ActionView {
  const declared: ActionView = {
    id: spec.id,
    label: spec.label,
    kind: spec.kind ?? 'custom',
    taskId: spec.taskId,
    target: spec.target,
    description: spec.description,
    sideEffect: spec.sideEffect ?? 'state',
    confirm: false,
    enabled: spec.enabled ?? true,
    params: spec.params?.map((p) => ({
      name: p.name,
      label: p.label ?? p.name,
      type: p.type ?? 'text',
      required: p.required,
      options: p.options,
      placeholder: p.placeholder,
      default: p.default,
    })),
    simulated: true,
  };

  const hint = policyFromHint(spec.sideEffect, spec.confirm);
  const provenance = resolve?.(declared);
  const effective = provenance ? stricterPolicy(hint, provenance.policy) : hint;

  return {
    ...declared,
    sideEffect: effective.effect,
    confirm: effective.confirmation === 'required',
    simulated: provenance ? provenance.simulated : true,
  };
}

function toRunView(spec: import('./types').RunSpec): RunView {
  const started = parseTime(spec.startedAt);
  const ended = parseTime(spec.endedAt);
  const durationMs =
    spec.durationMs ?? (started !== undefined && ended !== undefined ? Math.max(0, ended - started) : undefined);

  return {
    id: spec.id,
    taskId: spec.taskId,
    title: spec.title ?? spec.id,
    status: normalizeStatus(spec.status),
    startedAt: spec.startedAt,
    endedAt: spec.endedAt,
    durationMs,
    summary: spec.summary,
    artifacts: spec.artifacts ?? [],
    steps: spec.steps?.map((s, i) => ({
      id: s.id ?? `step-${i + 1}`,
      title: s.title,
      status: normalizeStatus(s.status),
      detail: s.detail,
      at: s.at,
    })),
    blocks: spec.blocks,
    simulated: false,
  };
}

function dedupeRuns(specs: import('./types').RunSpec[]): import('./types').RunSpec[] {
  const byId = new Map<string, import('./types').RunSpec>();
  for (const s of specs) {
    if (!byId.has(s.id)) byId.set(s.id, s);
  }
  return [...byId.values()].sort((a, b) => {
    const ta = parseTime(a.startedAt) ?? 0;
    const tb = parseTime(b.startedAt) ?? 0;
    return tb - ta;
  });
}

function sortGroups(groups: GroupSpec[]): GroupSpec[] {
  return groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => (a.g.order ?? a.i) - (b.g.order ?? b.i) || a.i - b.i)
    .map((x) => x.g);
}

/**
 * Producer statuses are open strings. Well-known ones get dedicated styling;
 * anything else still renders with a neutral treatment.
 */
function normalizeStatus(status: string | undefined): TaskStatus | (string & {}) {
  if (!status) return 'pending';
  return status as TaskStatus | (string & {});
}

function parseTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').trim();
}

function isPresent<T>(v: T | undefined | null): v is T {
  return v != null;
}
