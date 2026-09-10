import { basename } from 'node:path';
import type {
  ArtifactKind,
  ArtifactMeta,
  FileEntry,
  FileKind,
  Role,
  ScanResult,
  SectionKind,
  SemanticIR,
  SemanticNode,
  SemanticSource,
  WorkspaceIdentity,
} from '../types';
import type { ResolvedSemantics } from '../semantics/resolve';
import { contentKindOf } from '../scanner/classify';
import { scoreArtifact } from './scoring';
import type { Score } from './scoring';
import {
  buildMeta,
  countLines,
  diffStats,
  extractMarkdownHeading,
  imageDimensions,
  readHead,
} from './enrich';

// The semantic IR builder turns a flat list of scanned files into a tree of
// sections + artifacts, using the strongest available signal for each node:
//
//   explicit manifest  >  frontmatter  >  naming convention  >  heuristics
//
// When a producer declares groups, those groups *are* the information
// architecture and inferred sections only receive the leftovers. With no
// producer input at all this reduces to the original zero-config behaviour.

const SECTION_ORDER: SectionKind[] = [
  'overview', 'reports', 'changes', 'visuals', 'logs', 'data', 'code', 'other',
];

const REPORT_DIRS = /(^|\/)(outputs|reports|results|artifacts|deliverables|notes|radar|daily|summaries|analysis|docs)(\/|$)/i;
const REPORT_NAMES = /(report|summary|final|result|analysis|conclusion|decision|answer|overview)/i;

const README_RE = /^readme(\.|$)/i;

export interface BuildOptions {
  semantics?: ResolvedSemantics;
}

export function buildSemanticIR(scan: ScanResult, options: BuildOptions = {}): SemanticIR {
  const nowMs = Date.now();
  const semantics = options.semantics;
  const warnings = [...scan.warnings];
  const claimed = new Set<string>();

  // ---- 1. Turn each file into a semantic node -----------------------------
  const nodes = new Map<string, SemanticNode>();
  const nodeOrder: SemanticNode[] = [];

  for (const entry of scan.files) {
    const explicit = semantics?.items.get(entry.path);
    if (explicit?.hidden) {
      claimed.add(entry.path);
      continue;
    }

    const inferred = inferKind(entry);
    const kind: Role = explicit?.role ?? inferred.kind;
    const source: SemanticSource = explicit
      ? explicit.source
      : inferred.source;

    const node = buildArtifactNode(entry, kind, source, nowMs);

    if (explicit?.title) node.title = explicit.title;
    if (explicit?.summary) node.summary = explicit.summary;
    if (explicit?.group) node.group = explicit.group;
    if (explicit?.taskId) node.taskId = explicit.taskId;
    if (explicit?.priority !== undefined) node.priority = explicit.priority;
    if (explicit?.tags?.length) node.tags = mergeTags(node.tags, explicit.tags);
    if (explicit?.relations?.length) node.relations = explicit.relations.map(resolveRelation);
    if (explicit?.metrics) node.metrics = explicit.metrics;
    if (explicit?.blocks) node.blocks = explicit.blocks;

    claimed.add(entry.path);
    nodes.set(entry.path, node);
    nodeOrder.push(node);
  }

  // Warn about manifest items pointing at files that are not there — a common
  // producer bug worth surfacing rather than silently dropping.
  if (semantics) {
    for (const [path, item] of semantics.items) {
      if (item.hidden) continue;
      if (!nodes.has(path)) {
        warnings.push(`manifest references "${path}" but no such file was found in the workspace`);
      }
    }
  }

  // ---- 2. Group into sections ---------------------------------------------
  const explicitGroups = semantics?.groups ?? [];
  const sectionNodes: SemanticNode[] = [];

  if (explicitGroups.length > 0) {
    const byGroup = new Map<string, SemanticNode[]>();
    for (const node of nodeOrder) {
      if (!node.group) continue;
      if (!byGroup.has(node.group)) byGroup.set(node.group, []);
      byGroup.get(node.group)!.push(node);
    }
    for (const group of explicitGroups) {
      const children = byGroup.get(group.id);
      if (!children || children.length === 0) continue;
      byGroup.delete(group.id);
      sectionNodes.push({
        id: group.id,
        type: 'section',
        title: group.title ?? prettifyName(group.id),
        priority: 0,
        group: group.id,
        children: sortChildren(children),
      });
    }
    // Group ids that were referenced but never declared still deserve a home.
    for (const [groupId, children] of byGroup) {
      sectionNodes.push({
        id: groupId,
        type: 'section',
        title: prettifyName(groupId),
        priority: 0,
        group: groupId,
        children: sortChildren(children),
      });
    }

    // Leftovers keep the inferred treatment so a partial manifest never hides
    // an artifact from the human.
    const ungrouped = nodeOrder.filter((n) => !n.group);
    sectionNodes.push(...inferSections(ungrouped));
  } else {
    sectionNodes.push(...inferSections(nodeOrder));
  }

  // A producer group named `reports` and the inferred section of the same name
  // are two nodes with one id. Duplicate ids make every `find()` downstream
  // arbitrary — the router would reach one of them and never the other — so
  // they are folded together here, keeping the producer's node.
  const sections = mergeSectionsById(sectionNodes, warnings);

  const bytes = scan.files.reduce((sum, f) => sum + f.size, 0);
  const artifacts = [...nodes.values()].length;

  // A producer that declares who this workspace is outranks anything inferred
  // from a README heading or a directory name — explicit beats convention.
  const identity: WorkspaceIdentity = {
    ...scan.identity,
    name: semantics?.name ?? scan.identity.name,
    summary: semantics?.summary ?? scan.identity.summary,
  };

  const root: SemanticNode = {
    id: 'workspace',
    type: 'workspace',
    title: identity.name,
    priority: 0,
    children: sections,
  };

  return {
    id: hash(scan.rootDir),
    identity,
    git: scan.git,
    stats: {
      files: scan.files.length,
      artifacts,
      ignored: scan.ignored.length,
      bytes,
    },
    semantics: semantics?.origin ?? 'inferred',
    root,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Inference (the zero-config path, unchanged in spirit)
// ---------------------------------------------------------------------------

interface Inferred {
  kind: ArtifactKind;
  source: SemanticSource;
}

function inferKind(entry: FileEntry): Inferred {
  const name = basename(entry.path);
  if (entry.kind === 'markdown') {
    if (README_RE.test(name)) return { kind: 'readme', source: 'convention' };
    const dir = dirOf(entry.path);
    if (REPORT_DIRS.test(dir) || REPORT_NAMES.test(name)) {
      return { kind: 'report', source: 'convention' };
    }
    return { kind: 'markdown', source: 'heuristic' };
  }
  const map: Record<FileKind, ArtifactKind> = {
    markdown: 'markdown',
    code: 'code',
    json: 'json',
    log: 'log',
    diff: 'diff',
    image: 'image',
    binary: 'file',
    other: 'file',
  };
  return { kind: map[entry.kind], source: 'heuristic' };
}

/**
 * Folds sections that ended up with the same id into one.
 *
 * The collision is not hypothetical: `inferSections` names its sections after
 * the built-in kinds, while a producer may declare a group with any id at all
 * — including `reports` or `code`. Both then exist, the router's `find()` can
 * only ever reach the first, and the human sees a section they cannot open.
 *
 * The producer's node wins the id, the title and the position; the inferred
 * artifacts are appended to it, which is where they were going to be read
 * anyway. The merge is reported so a producer can rename the group if it meant
 * something else.
 */
function mergeSectionsById(sections: SemanticNode[], warnings: string[]): SemanticNode[] {
  const out: SemanticNode[] = [];
  const byId = new Map<string, SemanticNode>();

  for (const section of sections) {
    const existing = byId.get(section.id);
    if (!existing) {
      byId.set(section.id, section);
      out.push(section);
      continue;
    }
    existing.children = sortChildren([...existing.children, ...section.children]);
    if (existing.group && !section.group) {
      warnings.push(
        `group "${section.id}" has the same id as a built-in section; the inferred artifacts were merged into it`,
      );
    }
  }

  return out;
}

function inferSections(nodes: SemanticNode[]): SemanticNode[] {
  const buckets = new Map<SectionKind, SemanticNode[]>();
  for (const node of nodes) {
    const section = node.fallbackSection ?? 'other';
    if (!buckets.has(section)) buckets.set(section, []);
    buckets.get(section)!.push(node);
  }

  const out: SemanticNode[] = [];
  for (const sk of SECTION_ORDER) {
    const children = buckets.get(sk);
    if (!children || children.length === 0) continue;
    out.push({
      id: sk,
      type: 'section',
      title: SECTION_TITLES[sk],
      priority: 0,
      children: sortChildren(children),
    });
  }
  return out;
}

/** The section a built-in role maps to. Producer roles return undefined. */
function sectionForRole(kind: Role): SectionKind | undefined {
  switch (kind) {
    case 'readme': return 'overview';
    case 'report':
    case 'markdown': return 'reports';
    case 'diff': return 'changes';
    case 'image': return 'visuals';
    case 'log': return 'logs';
    case 'json': return 'data';
    case 'code': return 'code';
    default: return undefined;
  }
}

/**
 * The section a file's bytes map to, used when the role is producer-defined.
 * A producer can name an artifact "chart" or "signal"; it should still land
 * somewhere sensible rather than in "Other files".
 */
function sectionForFileKind(fileKind: FileKind): SectionKind {
  switch (fileKind) {
    case 'markdown': return 'reports';
    case 'diff': return 'changes';
    case 'image': return 'visuals';
    case 'log': return 'logs';
    case 'json': return 'data';
    case 'code': return 'code';
    default: return 'other';
  }
}

const SECTION_TITLES: Record<SectionKind, string> = {
  overview: 'Overview',
  reports: 'Reports',
  changes: 'Changes',
  visuals: 'Visuals',
  logs: 'Logs',
  data: 'Data',
  code: 'Code',
  other: 'Other files',
};

function sortChildren(children: SemanticNode[]): SemanticNode[] {
  return children.slice().sort(
    (a, b) => b.priority - a.priority || (b.meta?.mtimeMs ?? 0) - (a.meta?.mtimeMs ?? 0),
  );
}

// ---------------------------------------------------------------------------
// Artifact nodes
// ---------------------------------------------------------------------------

function buildArtifactNode(
  entry: FileEntry,
  kind: Role,
  source: SemanticSource,
  nowMs: number,
): SemanticNode {
  const scored = scoreArtifact(kind, entry, nowMs);
  const name = basename(entry.path);
  const contentKind = contentKindOf(entry.kind);

  let title = prettifyName(name);
  let summary: string | undefined;
  const meta = buildMeta(entry.size, entry.mtimeMs);

  // Enrichment follows the *content*, never the role. A producer is free to
  // call a markdown file "spec" or a PNG "evidence" and still get a heading
  // extracted and dimensions measured.
  //
  // Symlinks are skipped outright: nothing about them should reach the UI
  // beyond the fact that the link exists.
  if (entry.isSymlink) {
    summary = 'symlink — not followed';
    return finishArtifact(entry, kind, source, scored, title, summary, meta);
  }

  switch (contentKind) {
    case 'markdown': {
      const head = extractMarkdownHeading(readHead(entry.absolutePath, 16 * 1024));
      if (head.title) title = head.title;
      summary = head.summary;
      break;
    }
    case 'diff': {
      const s = diffStats(entry.absolutePath);
      // A diff's file count is not a line count. Keeping them in one field
      // made a two-file patch report itself as "2 lines".
      meta.fileCount = s.files;
      if (s.files > 0) summary = `${s.files} file${s.files === 1 ? '' : 's'} · +${s.added} −${s.removed}`;
      break;
    }
    case 'log': {
      const lines = countLines(entry.absolutePath, 2 * 1024 * 1024);
      if (lines !== undefined) meta.lineCount = lines;
      summary = lines !== undefined ? `${lines} line${lines === 1 ? '' : 's'}` : undefined;
      break;
    }
    case 'code': {
      summary = meta.language;
      break;
    }
    case 'json': {
      summary = 'structured data';
      break;
    }
    case 'image': {
      const dims = imageDimensions(entry.absolutePath, entry.ext);
      if (dims) {
        meta.imageWidth = dims.width;
        meta.imageHeight = dims.height;
        summary = `${dims.width} × ${dims.height}`;
      } else {
        summary = 'image';
      }
      break;
    }
    default: {
      summary = entry.kind === 'binary' ? 'binary file' : dirOf(entry.path) || undefined;
      break;
    }
  }

  if (entry.sensitive) summary = 'sensitive — content withheld';
  return finishArtifact(entry, kind, source, scored, title, summary, meta);
}

function finishArtifact(
  entry: FileEntry,
  kind: Role,
  source: SemanticSource,
  scored: Score,
  title: string,
  summary: string | undefined,
  meta: ArtifactMeta,
): SemanticNode {
  return {
    id: entry.path,
    type: 'artifact',
    title,
    kind,
    content: contentKindOf(entry.kind),
    path: entry.path,
    summary,
    priority: scored.priority,
    meta,
    tags: scored.tags.length ? scored.tags : undefined,
    source,
    relations: undefined,
    fallbackSection: sectionForRole(kind) ?? sectionForFileKind(entry.kind),
    children: [],
  };
}

function resolveRelation(relation: import('../types').Relation): import('../types').Relation {
  const target = relation.target.replace(/\\/g, '/').replace(/^\.\//, '');
  return { ...relation, target };
}

function mergeTags(a: string[] | undefined, b: string[]): string[] {
  const out = [...(a ?? [])];
  for (const t of b) if (!out.includes(t)) out.push(t);
  return out;
}

function prettifyName(name: string): string {
  const dot = name.lastIndexOf('.');
  // Keep dotfiles (".env", ".gitignore") intact — only strip a real extension.
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const pretty = stem.replace(/[-_]+/g, ' ').trim();
  return pretty || name;
}

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

// FNV-1a 32-bit hash — deterministic, dependency-free.
export function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
