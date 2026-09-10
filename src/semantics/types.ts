import type { Block, Metric, Relation, SideEffect, TaskStatus } from '../types';

// ---------------------------------------------------------------------------
// The A2H producer protocol.
//
// This is the schema a producer (agent, workflow runner, model, human) writes
// so A2H does not have to guess. It is intentionally small and forgiving:
// every field is optional, unknown fields are ignored, and anything that fails
// validation degrades to a warning plus heuristic inference.
//
// Canonical location:  <workspace>/.a2h/manifest.json
// Alias:               <workspace>/a2h.json
//
// A producer that can only append files may also drop one JSON document per
// run into <workspace>/.a2h/runs/*.json — see RunSpecFile.
// ---------------------------------------------------------------------------

export interface GroupSpec {
  id: string;
  title?: string;
  description?: string;
  /** Sort hint for the group, ascending. */
  order?: number;
  taskId?: string;
}

export interface ProgressSpec {
  done: number;
  total: number;
  label?: string;
}

export interface TaskSpec {
  id: string;
  title?: string;
  status?: TaskStatus | (string & {});
  summary?: string;
  group?: string;
  owner?: string;
  updatedAt?: string;
  progress?: ProgressSpec;
  metrics?: Metric[];
  blocks?: Block[];
  /** Action ids attached to this task. */
  actions?: string[];
  /** Workspace-relative artifact paths belonging to this task. */
  artifacts?: string[];
}

export interface RunStepSpec {
  id?: string;
  title: string;
  status?: TaskStatus | (string & {});
  detail?: string;
  at?: string;
}

export interface RunSpec {
  id: string;
  taskId?: string;
  title?: string;
  status?: TaskStatus | (string & {});
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  summary?: string;
  artifacts?: string[];
  steps?: RunStepSpec[];
  blocks?: Block[];
}

/** Shape of a file in `.a2h/runs/`. Either a single run or `{ runs: [...] }`. */
export type RunSpecFile = RunSpec | { runs: RunSpec[] };

export interface ActionParamSpec {
  name: string;
  label?: string;
  type?: 'text' | 'textarea' | 'select' | 'boolean';
  required?: boolean;
  options?: string[];
  placeholder?: string;
  default?: string | boolean;
}

export interface ActionSpec {
  id: string;
  label: string;
  kind?: string;
  taskId?: string;
  target?: string;
  description?: string;
  /**
   * 'none'   — pure navigation / client-side
   * 'state'  — changes A2H-visible state only
   * 'external' — would leave A2H (send to agent, publish, apply diff)
   * Defaults to 'state', the conservative middle ground.
   *
   * This is a *hint*. The executor that will run the action states the
   * authoritative policy, and the two are merged with the stricter one
   * winning — a workspace can escalate, never relax.
   */
  sideEffect?: SideEffect;
  /** Ask for confirmation even when the effective policy would not require it. */
  confirm?: boolean;
  params?: ActionParamSpec[];
  /** Set false to render the action as unavailable. */
  enabled?: boolean;
}

export interface ItemSpec {
  path: string;
  role?: string;
  title?: string;
  summary?: string;
  group?: string;
  taskId?: string;
  priority?: number;
  tags?: string[];
  hidden?: boolean;
  relations?: Relation[];
  metrics?: Metric[];
  blocks?: Block[];
}

export interface Manifest {
  /** Protocol version. Absent is treated as 1. */
  a2h?: number;
  name?: string;
  summary?: string;
  groups?: GroupSpec[];
  tasks?: TaskSpec[];
  runs?: RunSpec[];
  actions?: ActionSpec[];
  items?: ItemSpec[];
  /** Workspace-level composed blocks shown above the sections. */
  panels?: Block[];
}

// ---------------------------------------------------------------------------
// Resolution result
// ---------------------------------------------------------------------------

/** Per-artifact semantics after merging manifest + frontmatter. */
export interface ResolvedItem {
  role?: string;
  title?: string;
  summary?: string;
  group?: string;
  taskId?: string;
  priority?: number;
  tags?: string[];
  hidden?: boolean;
  relations?: Relation[];
  metrics?: Metric[];
  blocks?: Block[];
  /** Which layer supplied these semantics. */
  source: 'explicit' | 'frontmatter';
}

/** Producer metadata parsed out of a markdown frontmatter block. */
export interface FrontmatterSemantics {
  role?: string;
  title?: string;
  summary?: string;
  group?: string;
  taskId?: string;
  status?: string;
  priority?: number;
  tags?: string[];
  hidden?: boolean;
}

export interface LoadedSemantics {
  manifest?: Manifest;
  /** Path the manifest was read from, relative to the root. */
  manifestPath?: string;
  taskSpecs: TaskSpec[];
  runSpecs: RunSpec[];
  actionSpecs: ActionSpec[];
  itemSpecs: ItemSpec[];
  groupSpecs: GroupSpec[];
  panels?: Block[];
  frontmatter: Map<string, FrontmatterSemantics>;
  name?: string;
  summary?: string;
  warnings: string[];
}
