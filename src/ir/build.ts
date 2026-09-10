import { basename } from 'node:path';
import type {
  ArtifactKind,
  FileEntry,
  FileKind,
  ScanResult,
  SectionKind,
  SemanticIR,
  SemanticNode,
} from '../types';
import { scoreArtifact } from './scoring';
import {
  buildMeta,
  countLines,
  diffStats,
  extractMarkdownHeading,
  imageDimensions,
  readHead,
} from './enrich';

// The semantic IR builder turns a flat list of scanned files into a tree of
// sections + artifacts. This is where the filesystem tree becomes the semantic
// tree: human information architecture replaces raw directory layout.

const SECTION_ORDER: SectionKind[] = [
  'overview', 'reports', 'changes', 'visuals', 'logs', 'data', 'code', 'other',
];

const REPORT_DIRS = /(^|\/)(outputs|reports|results|artifacts|deliverables|notes|radar|daily|summaries|analysis|docs)(\/|$)/i;
const REPORT_NAMES = /(report|summary|final|result|analysis|conclusion|decision|answer|overview)/i;

const README_RE = /^readme(\.|$)/i;

function isReadmeName(name: string): boolean {
  return README_RE.test(name);
}

function semanticKind(entry: FileEntry): ArtifactKind {
  const name = basename(entry.path);
  if (entry.kind === 'markdown') {
    if (isReadmeName(name)) return 'readme';
    const dir = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
    if (REPORT_DIRS.test(dir) || REPORT_NAMES.test(name)) return 'report';
    return 'markdown';
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
  return map[entry.kind];
}

function sectionFor(kind: ArtifactKind): SectionKind {
  switch (kind) {
    case 'readme': return 'overview';
    case 'report':
    case 'markdown': return 'reports';
    case 'diff': return 'changes';
    case 'image': return 'visuals';
    case 'log': return 'logs';
    case 'json': return 'data';
    case 'code': return 'code';
    default: return 'other';
  }
}

function titleFor(kind: ArtifactKind, entry: FileEntry, heading?: string): string {
  if ((kind === 'markdown' || kind === 'report') && heading) return heading;
  return prettifyName(basename(entry.path));
}

function prettifyName(name: string): string {
  const dot = name.lastIndexOf('.');
  // Keep dotfiles (".env", ".gitignore") intact — only strip a real extension.
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const pretty = stem.replace(/[-_]+/g, ' ').trim();
  return pretty || name;
}

function shortPath(entry: FileEntry): string {
  const dir = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
  return dir || '.';
}

function buildArtifactNode(
  entry: FileEntry,
  kind: ArtifactKind,
  nowMs: number,
): SemanticNode {
  const { priority, tags } = scoreArtifact(kind, entry, nowMs);
  const name = basename(entry.path);

  let title = prettifyName(name);
  let summary: string | undefined;
  const meta = buildMeta(entry.size, entry.mtimeMs);

  switch (kind) {
    case 'readme':
    case 'report':
    case 'markdown': {
      const head = extractMarkdownHeading(readHead(entry.absolutePath, 16 * 1024));
      if (head.title) title = head.title;
      summary = head.summary;
      break;
    }
    case 'diff': {
      const s = diffStats(entry.absolutePath);
      meta.lineCount = s.files;
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
    case 'file': {
      summary = entry.kind === 'binary' ? 'binary file' : shortPath(entry);
      break;
    }
  }

  return {
    id: entry.path,
    type: 'artifact',
    title,
    kind,
    path: entry.path,
    summary,
    priority,
    meta,
    tags: tags.length ? tags : undefined,
    children: [],
  };
}

export function buildSemanticIR(scan: ScanResult): SemanticIR {
  const nowMs = Date.now();
  const sections = new Map<SectionKind, SemanticNode[]>();

  for (const entry of scan.files) {
    const kind = semanticKind(entry);
    const section = sectionFor(kind);
    const node = buildArtifactNode(entry, kind, nowMs);
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push(node);
  }

  const sectionNodes: SemanticNode[] = [];
  for (const sk of SECTION_ORDER) {
    const artifacts = sections.get(sk);
    if (!artifacts || artifacts.length === 0) continue;
    artifacts.sort((a, b) => b.priority - a.priority || b.meta!.mtimeMs - a.meta!.mtimeMs);
    sectionNodes.push({
      id: sk,
      type: 'section',
      title: SECTION_TITLES[sk],
      priority: 0,
      children: artifacts,
    });
  }

  const root: SemanticNode = {
    id: 'workspace',
    type: 'workspace',
    title: scan.identity.name,
    priority: 0,
    children: sectionNodes,
  };

  const bytes = scan.files.reduce((sum, f) => sum + f.size, 0);

  return {
    id: hash(scan.rootDir),
    identity: scan.identity,
    git: scan.git,
    stats: {
      files: scan.files.length,
      artifacts: scan.files.length,
      ignored: scan.ignored.length,
      bytes,
    },
    root,
    warnings: scan.warnings,
  };
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

// FNV-1a 32-bit hash — deterministic, dependency-free.
export function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
