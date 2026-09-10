// A2H core types.
//
// These types form the contract between the scanner, semantics resolver,
// semantic IR builder, presentation layer, content renderers, action
// executors, and the local server. They are deliberately framework-free:
// nothing here imports React or any renderer.
//
// The layering, in order:
//
//   filesystem
//     -> scanner            (FileEntry: what bytes exist)
//     -> semantics          (explicit manifest / frontmatter / conventions)
//     -> semantic IR        (SemanticNode: what things mean)
//     -> presentation IR    (Presentation: what a human should see, in order)
//     -> renderer           (ArtifactContent + Block payloads)
//     -> local web UI

// ---------------------------------------------------------------------------
// Scanner layer
// ---------------------------------------------------------------------------

/** Broad classification of a scanned file. Extension-driven, least trusted. */
export type FileKind =
  | 'markdown'
  | 'code'
  | 'json'
  | 'log'
  | 'diff'
  | 'image'
  | 'binary'
  | 'other';

/**
 * How a file's bytes should be drawn. Separate from `Role` on purpose: a role
 * is what a thing *means* ("spec", "evidence", "draft"), a content kind is what
 * it *is* ("markdown", "image"). A producer can call a PNG anything it likes and
 * it will still be drawn as an image.
 *
 * Published on the view so a client can decide how to present an artifact
 * without fetching it first.
 */
export type ContentKind = 'markdown' | 'code' | 'json' | 'log' | 'diff' | 'image' | 'file';

export interface FileEntry {
  /** POSIX-style path relative to the workspace root, e.g. "outputs/a.md". */
  path: string;
  absolutePath: string;
  kind: FileKind;
  /** Size in bytes. */
  size: number;
  /** Last modified time in epoch ms. */
  mtimeMs: number;
  /** Lowercase extension without the leading dot, e.g. "md" ("" if none). */
  ext: string;
  isSymlink: boolean;
  /** Content looks like a secret / credential — do not preview. */
  sensitive: boolean;
  /** Directory depth from the workspace root. */
  depth: number;
}

export interface IgnoredEntry {
  path: string;
  reason: string;
}

export interface GitInfo {
  isRepo: boolean;
  branch?: string;
  lastCommit?: { hash: string; dateMs: number; subject: string };
}

export interface WorkspaceIdentity {
  /** Human-facing name for the workspace. */
  name: string;
  /** One-line summary, typically sourced from the README or git remote. */
  summary?: string;
}

export interface ScanResult {
  rootDir: string;
  identity: WorkspaceIdentity;
  git: GitInfo;
  files: FileEntry[];
  ignored: IgnoredEntry[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Semantic IR
// ---------------------------------------------------------------------------

/**
 * The built-in (inferred) roles. Producers may use any other string; A2H
 * treats unknown roles as opaque labels and falls back to a generic card.
 */
export type ArtifactKind =
  | 'readme'
  | 'markdown'
  | 'report'
  | 'code'
  | 'json'
  | 'log'
  | 'diff'
  | 'image'
  | 'file';

/**
 * An open role string. `ArtifactKind | (string & {})` keeps autocomplete for
 * the built-ins while accepting producer-defined roles such as "signal" or
 * "test-plan".
 */
export type Role = ArtifactKind | (string & {});

/** How a node's semantics were established. Ordered by trust, highest first. */
export type SemanticSource = 'explicit' | 'frontmatter' | 'convention' | 'heuristic';

export interface ArtifactMeta {
  size: number;
  mtimeMs: number;
  /** Lines in the file's own text. Never the number of files touched. */
  lineCount?: number;
  /** Files touched by a diff. */
  fileCount?: number;
  language?: string;
  imageWidth?: number;
  imageHeight?: number;
}

/** Built-in fallback sections. Explicit groups may use any string id. */
export type SectionKind =
  | 'overview'
  | 'reports'
  | 'changes'
  | 'visuals'
  | 'logs'
  | 'data'
  | 'code'
  | 'other';

export type RelationKind =
  | 'related'
  | 'derived-from'
  | 'supports'
  | 'supersedes'
  | 'produced-by';

export interface Relation {
  kind: RelationKind | (string & {});
  /** Workspace-relative path or node id. */
  target: string;
  note?: string;
}

export interface Metric {
  label: string;
  value: string | number;
  unit?: string;
  delta?: string;
  tone?: Tone;
}

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

export interface SemanticNode {
  /**
   * Stable id. For artifacts this is the workspace-relative path (unique).
   * For sections it is a slug such as "reports".
   */
  id: string;
  type: 'workspace' | 'section' | 'group' | 'artifact';
  title: string;
  /** Open semantic role. */
  kind?: Role;
  /** How the bytes will be drawn, independent of the role. */
  content?: ContentKind;
  /** Workspace-relative path (artifacts only). */
  path?: string;
  summary?: string;
  /** Higher = more important / should be shown earlier. */
  priority: number;
  meta?: ArtifactMeta;
  /** Short human tags, e.g. "final", "latest", "stale". */
  tags?: string[];
  /** Where the semantics came from. */
  source?: SemanticSource;
  /** Producer-declared group id (falls back to the derived section). */
  group?: string;
  /** Owning task id, when the producer declared one. */
  taskId?: string;
  /** Explicit relations to other artifacts. */
  relations?: Relation[];
  /** Producer-declared metrics. */
  metrics?: Metric[];
  /** Producer-authored presentation blocks for this artifact. */
  blocks?: Block[];
  /**
   * Which inferred section this artifact belongs to when no producer group
   * claims it. Derived from the role if it is a built-in one, otherwise from
   * the file's actual kind — so a producer role never loses basic placement.
   */
  fallbackSection?: SectionKind;
  children: SemanticNode[];
}

export interface SemanticIR {
  /** Stable id for the whole workspace (hash of absolute path). */
  id: string;
  identity: WorkspaceIdentity;
  git: GitInfo;
  stats: { files: number; artifacts: number; ignored: number; bytes: number };
  /** Which semantics layer actually shaped this IR. */
  semantics: SemanticsOrigin;
  root: SemanticNode;
  warnings: string[];
}

export type SemanticsOrigin = 'explicit' | 'mixed' | 'inferred';

// ---------------------------------------------------------------------------
// Presentation IR
// ---------------------------------------------------------------------------

/**
 * Presentation blocks. These are the units the renderer knows how to draw.
 * A producer can author any of them in the manifest; A2H also synthesises
 * some from the task/run/action model.
 *
 * `type` is an open string so new block kinds can be added without touching
 * this union's consumers — the client keeps a renderer registry.
 */
export interface TextBlock {
  type: 'text';
  id?: string;
  title?: string;
  text: string;
  tone?: Tone;
}

export interface MarkdownBlock {
  type: 'markdown';
  id?: string;
  title?: string;
  /**
   * Server-rendered HTML. Producers never set this — they supply `text` or
   * `path` and the presentation layer compiles it with the same conservative
   * renderer used for artifact content.
   */
  html?: string;
  /** Literal markdown source. */
  text?: string;
  /** Workspace-relative file to read the markdown from. */
  path?: string;
}

export interface ListItem {
  title: string;
  detail?: string;
  href?: string;
  status?: TaskStatus | (string & {});
  meta?: string;
}

export interface ListBlock {
  type: 'list';
  id?: string;
  title?: string;
  items: ListItem[];
  ordered?: boolean;
}

export interface TableBlock {
  type: 'table';
  id?: string;
  title?: string;
  columns: { key: string; label: string; align?: 'left' | 'right' }[];
  rows: Record<string, string>[];
  note?: string;
}

export interface ComparisonOption {
  title: string;
  summary?: string;
  facts: { label: string; value: string }[];
  tone?: Tone;
}

export interface ComparisonBlock {
  type: 'comparison';
  id?: string;
  title?: string;
  options: ComparisonOption[];
  conclusion?: string;
}

export interface MetricsBlock {
  type: 'metrics';
  id?: string;
  title?: string;
  items: Metric[];
}

export interface TimelineItem {
  at?: string;
  title: string;
  detail?: string;
  status?: TaskStatus | (string & {});
}

export interface TimelineBlock {
  type: 'timeline';
  id?: string;
  title?: string;
  items: TimelineItem[];
}

export interface StatusBlock {
  type: 'status';
  id?: string;
  title?: string;
  status: TaskStatus | (string & {});
  detail?: string;
}

export interface KeyValueBlock {
  type: 'keyvalue';
  id?: string;
  title?: string;
  items: { key: string; value: string; mono?: boolean }[];
}

export interface NoticeBlock {
  type: 'notice';
  id?: string;
  title?: string;
  text: string;
  tone?: 'info' | 'warn' | 'error';
}

export interface ActionsBlock {
  type: 'actions';
  id?: string;
  title?: string;
  /** Action ids, resolved against the workspace action registry. */
  ids: string[];
}

export type Block =
  | TextBlock
  | MarkdownBlock
  | ListBlock
  | TableBlock
  | ComparisonBlock
  | MetricsBlock
  | TimelineBlock
  | StatusBlock
  | KeyValueBlock
  | NoticeBlock
  | ActionsBlock
  // Open for extension: producers/tests may emit other shapes.
  | { type: string; id?: string; title?: string; [key: string]: unknown };

export interface ArtifactView {
  id: string;
  title: string;
  kind: Role;
  /** How this artifact's bytes will be drawn. Lets the client pick a renderer. */
  content: ContentKind;
  path?: string;
  summary?: string;
  meta?: ArtifactMeta;
  tags?: string[];
  priority: number;
  source?: SemanticSource;
  /**
   * The producer-declared group, when there was one. The section an artifact
   * appears in is its *home*; the group is the producer's own labelling, which
   * matters when a section holds more than one group or on a task page.
   */
  group?: string;
  taskId?: string;
  relations?: Relation[];
  metrics?: Metric[];
}

export interface GroupView {
  id: string;
  title: string;
  description?: string;
  artifacts: ArtifactView[];
  taskId?: string;
}

export interface SectionView {
  id: string;
  title: string;
  kind: SectionKind | (string & {});
  description?: string;
  artifacts: ArtifactView[];
  /** True when the section came from a producer-declared group. */
  explicit?: boolean;
}

// ---- Task / Run / Action --------------------------------------------------

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'partial'
  | 'blocked'
  | 'cancelled'
  | 'info';

export interface RunStep {
  id: string;
  title: string;
  status: TaskStatus | (string & {});
  detail?: string;
  at?: string;
}

export interface RunView {
  id: string;
  taskId?: string;
  title: string;
  status: TaskStatus | (string & {});
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  summary?: string;
  /** Workspace-relative paths produced by this run. */
  artifacts: string[];
  steps?: RunStep[];
  blocks?: Block[];
  /** True when this run is real; false when produced by a mock provider. */
  simulated?: boolean;
}

export interface ActionParam {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'boolean';
  required?: boolean;
  options?: string[];
  placeholder?: string;
  default?: string | boolean;
}

/**
 * How far an action's effect reaches.
 *
 *   none     — navigation only; nothing changes
 *   state    — changes state A2H can see
 *   external — would leave this machine (send to an agent, publish, apply a diff)
 *
 * Two parties have an opinion about this: the workspace (which hints) and the
 * executor that will actually run the action (which is authoritative). See
 * `actions/policy.ts` for the merge — it can only ever raise the level.
 */
export type SideEffect = 'none' | 'state' | 'external';

/**
 * A provider's authoritative statement about one action: what it will do, and
 * whether a human must confirm it first.
 */
export interface EffectPolicy {
  effect: SideEffect;
  /** 'required' means a human must confirm before the action runs. */
  confirmation: 'required' | 'optional';
}

export interface ActionView {
  id: string;
  label: string;
  /** Open kind: approve / reject / retry / run / publish / open / discard … */
  kind: string;
  taskId?: string;
  target?: string;
  description?: string;
  /**
   * How far the side effect reaches — already merged with the executor's own
   * policy, so this is the *effective* level rather than the workspace's claim.
   */
  sideEffect: SideEffect;
  /** Requires an explicit second confirmation before executing. */
  confirm: boolean;
  enabled: boolean;
  params?: ActionParam[];
  /**
   * True when the executor that will run *this* action only simulates it.
   * Per action, not per workspace: a real provider may own one action while
   * the built-in simulator owns the next one.
   */
  simulated: boolean;
}

export interface TaskView {
  id: string;
  title: string;
  status: TaskStatus | (string & {});
  summary?: string;
  group?: string;
  owner?: string;
  updatedAt?: string;
  progress?: { done: number; total: number; label?: string };
  metrics?: Metric[];
  blocks?: Block[];
  /** Artifact ids (workspace-relative paths) belonging to this task. */
  artifacts: string[];
  runs: RunView[];
  actions: ActionView[];
  source: SemanticSource;
}

export interface Presentation {
  identity: WorkspaceIdentity;
  git: GitInfo;
  stats: { files: number; artifacts: number; ignored: number; bytes: number };
  /** 'explicit' when a manifest shaped the view; 'inferred' for zero-config. */
  semantics: SemanticsOrigin;
  /**
   * True when at least one declared action will be simulated by its executor.
   * Deliberately not "all": a workspace may hand one action to a real provider
   * and let the next fall through to the built-in simulator. Read the per-action
   * `ActionView.simulated` for anything the human is about to click.
   */
  simulatedActions: boolean;
  highlights: ArtifactView[];
  sections: SectionView[];
  tasks: TaskView[];
  runs: RunView[];
  actions: ActionView[];
  /** Workspace-level composed blocks (the "panel"). */
  panels: Block[];
  /**
   * The action trail: attempts made in this session (newest first) followed by
   * durable decision records read back from `.a2h/decisions/`, so a decision
   * still shows after the viewer restarts.
   */
  audit: DecisionRecord[];
  warnings: string[];
}

/** One line of the session action trail. */
export interface ActionAuditEntry {
  at: string;
  actionId: string;
  kind: string;
  sideEffect: string;
  ok: boolean;
  simulated: boolean;
  message: string;
  executor: string;
}

/**
 * A durable record of one action attempt, written under
 * `.a2h/decisions/<utc>-<actionId>.json`.
 *
 * It is an audit trail, never an input: loading these can change what the
 * viewer *shows* about the past, and can never grant an action authority or
 * waive confirmation. The executor policy remains the only source of that.
 */
export interface DecisionRecord extends ActionAuditEntry {
  /** Protocol version of the record itself. Absent is treated as 1. */
  a2h?: number;
  /**
   * The parameters that were actually executed — already filtered against the
   * action's declared schema, so undeclared keys are absent by construction.
   */
  params?: Record<string, string>;
  /** Owning task id, when the action declared one. */
  taskId?: string;
}

// ---------------------------------------------------------------------------
// Content render payloads (server -> client)
// ---------------------------------------------------------------------------

export interface Frontmatter {
  data: Record<string, unknown>;
}

export interface MarkdownContent {
  type: 'markdown';
  html: string;
  title?: string;
  frontmatter?: Record<string, unknown>;
}

export interface CodeContent {
  type: 'code';
  language: string;
  raw: string;
  totalLines: number;
  truncated: boolean;
}

export interface DiffFile {
  path: string;
  from?: string;
  to?: string;
  status: 'added' | 'removed' | 'modified' | 'renamed';
  added: number;
  removed: number;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'add' | 'del';
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface DiffContent {
  type: 'diff';
  files: DiffFile[];
  totalLines: number;
  truncated?: boolean;
}

export interface JsonContent {
  type: 'json';
  data: unknown;
  valid: boolean;
  /** Raw text, possibly truncated. */
  raw: string;
  truncated: boolean;
}

export interface LogContent {
  type: 'log';
  tail: string[];
  totalLines: number;
  truncated: boolean;
  hasErrors: boolean;
  hasWarnings: boolean;
  /** Zero-based line numbers (of the full log) that contain errors. */
  errorLines: number[];
}

export interface ImageContent {
  type: 'image';
  url: string;
  width?: number;
  height?: number;
}

export interface FileContent {
  type: 'file';
  isBinary: boolean;
  /** Short text preview for text files (truncated). */
  text?: string;
  truncated?: boolean;
  /** Optional note, e.g. "sensitive" or "symlink". */
  note?: string;
}

export type ArtifactContent =
  | MarkdownContent
  | CodeContent
  | DiffContent
  | JsonContent
  | LogContent
  | ImageContent
  | FileContent;

export interface ArtifactPayload {
  id: string;
  title: string;
  kind: Role;
  path?: string;
  summary?: string;
  meta?: ArtifactMeta;
  tags?: string[];
  content: ArtifactContent;
  /** Producer-authored blocks, pre-resolved for rendering. */
  blocks?: Block[];
  relations?: Relation[];
  taskId?: string;
}

// ---------------------------------------------------------------------------
// Action execution (server -> client)
// ---------------------------------------------------------------------------

export interface ActionRequest {
  id: string;
  params?: Record<string, string>;
  /** Set by the client after the user confirms a side-effecting action. */
  confirm?: boolean;
}

export interface ActionResult {
  ok: boolean;
  actionId: string;
  /** Human-readable outcome line. */
  message: string;
  /** True when a mock provider produced this result. */
  simulated: boolean;
  /** Run created by the action, when the executor produced one. */
  run?: RunView;
  /** Task whose state changed, with its new status. */
  task?: { id: string; status: string };
  error?: string;
}
