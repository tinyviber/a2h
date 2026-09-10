// A2H core types.
//
// These types form the contract between the scanner, semantic IR builder,
// presentation layer, content renderers, and the local server. They are
// deliberately framework-free: nothing here imports React or any renderer.

// ---------------------------------------------------------------------------
// Scanner layer
// ---------------------------------------------------------------------------

/** Broad classification of a scanned file. */
export type FileKind =
  | 'markdown'
  | 'code'
  | 'json'
  | 'log'
  | 'diff'
  | 'image'
  | 'binary'
  | 'other';

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

/** Semantic artifact kind (what a thing *means* to a human reader). */
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

export interface ArtifactMeta {
  size: number;
  mtimeMs: number;
  lineCount?: number;
  language?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export type SectionKind =
  | 'overview'
  | 'reports'
  | 'changes'
  | 'visuals'
  | 'logs'
  | 'data'
  | 'code'
  | 'other';

export interface SemanticNode {
  /**
   * Stable id. For artifacts this is the workspace-relative path (unique).
   * For sections it is a fixed slug such as "reports".
   */
  id: string;
  type: 'workspace' | 'section' | 'artifact';
  title: string;
  kind?: ArtifactKind;
  /** Workspace-relative path (artifacts only). */
  path?: string;
  summary?: string;
  /** Higher = more important / should be shown earlier. */
  priority: number;
  meta?: ArtifactMeta;
  /** Short human tags, e.g. "final", "latest", "stale". */
  tags?: string[];
  children: SemanticNode[];
}

export interface SemanticIR {
  /** Stable id for the whole workspace (hash of absolute path). */
  id: string;
  identity: WorkspaceIdentity;
  git: GitInfo;
  stats: { files: number; artifacts: number; ignored: number; bytes: number };
  root: SemanticNode;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Presentation tree
// ---------------------------------------------------------------------------

export interface ArtifactView {
  id: string;
  title: string;
  kind: ArtifactKind;
  path?: string;
  summary?: string;
  meta?: ArtifactMeta;
  tags?: string[];
  priority: number;
}

export interface SectionView {
  id: string;
  title: string;
  kind: SectionKind;
  description?: string;
  artifacts: ArtifactView[];
}

export interface Presentation {
  identity: WorkspaceIdentity;
  git: GitInfo;
  stats: { files: number; artifacts: number; ignored: number; bytes: number };
  highlights: ArtifactView[];
  sections: SectionView[];
  warnings: string[];
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
  kind: ArtifactKind;
  path?: string;
  summary?: string;
  meta?: ArtifactMeta;
  tags?: string[];
  content: ArtifactContent;
}
