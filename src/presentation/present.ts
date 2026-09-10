import type {
  ArtifactView,
  Block,
  Presentation,
  SectionKind,
  SectionView,
  SemanticIR,
  SemanticNode,
  TaskView,
} from '../types';
import type { ResolvedSemantics } from '../semantics/resolve';
import { resolveBlocks, type BlockContext } from './blocks';

// Presentation layer: maps the semantic IR into the final ordered view the
// renderer consumes. This is the fourth tree — ordering, "what to read first",
// section descriptions, and the task/run/action surface live here, not in the
// IR. Nothing in this file is renderer-specific.

const SECTION_DESCRIPTIONS: Partial<Record<SectionKind, string>> = {
  overview: 'The entry point — what this workspace is about.',
  reports: 'Written outputs, notes, and summaries.',
  changes: 'Diffs and patches worth reviewing.',
  visuals: 'Screenshots and generated images.',
  logs: 'Build and run logs.',
  data: 'Structured JSON data.',
  code: 'Source files.',
  other: 'Everything else the scanner found.',
};

const MAX_HIGHLIGHTS = 5;

export interface PresentOptions {
  semantics?: ResolvedSemantics;
  /** Needed to resolve producer-authored markdown blocks. */
  blockContext?: BlockContext;
}

export function present(ir: SemanticIR, options: PresentOptions = {}): Presentation {
  const semantics = options.semantics;
  const ctx: BlockContext = options.blockContext ?? { rootDir: '' };

  const sections: SectionView[] = ir.root.children.map((section) => ({
    id: section.id,
    title: section.title,
    kind: section.id as SectionKind,
    description: SECTION_DESCRIPTIONS[section.id as SectionKind],
    artifacts: section.children.map(toView),
    explicit: Boolean(semantics?.groups.some((g) => g.id === section.id)),
  }));

  const allArtifacts = sections.flatMap((s) => s.artifacts);
  const byId = new Map(allArtifacts.map((a) => [a.id, a]));

  const nonReadme = allArtifacts.filter((a) => a.kind !== 'readme');
  nonReadme.sort(
    (a, b) => b.priority - a.priority || (b.meta?.mtimeMs ?? 0) - (a.meta?.mtimeMs ?? 0),
  );

  const tasks = (semantics?.tasks ?? []).map((task) =>
    attachTaskArtifacts(task, byId, ctx),
  );

  const runs = (semantics?.runs ?? []).map((run) => ({
    ...run,
    blocks: resolveBlocks(run.blocks, ctx),
  }));

  const warnings = [...ir.warnings, ...(semantics?.warnings ?? [])];

  return {
    identity: ir.identity,
    git: ir.git,
    stats: ir.stats,
    semantics: ir.semantics,
    simulatedActions: semantics?.actions.some((a) => a.simulated) ?? false,
    highlights: nonReadme.slice(0, MAX_HIGHLIGHTS),
    sections,
    tasks,
    runs,
    actions: semantics?.actions ?? [],
    panels: resolveBlocks(semantics?.panels, ctx) ?? [],
    audit: [],
    warnings,
  };
}

function toView(node: SemanticNode): ArtifactView {
  return {
    id: node.id,
    title: node.title,
    kind: node.kind ?? 'file',
    content: node.content ?? 'file',
    path: node.path,
    summary: node.summary,
    meta: node.meta,
    tags: node.tags,
    priority: node.priority,
    source: node.source,
    group: node.group,
    taskId: node.taskId,
    relations: node.relations,
    metrics: node.metrics,
  };
}

/**
 * A task's artifact list is the union of what the producer declared and what
 * items actually point at the task. Paths that do not resolve to a scanned
 * file are dropped rather than rendered as dead links.
 */
function attachTaskArtifacts(
  task: TaskView,
  byId: Map<string, ArtifactView>,
  ctx: BlockContext,
): TaskView {
  const seen = new Set<string>();
  const artifacts: string[] = [];
  for (const path of task.artifacts) {
    const normalized = path.replace(/^\.\//, '');
    if (seen.has(normalized)) continue;
    if (!byId.has(normalized)) continue;
    seen.add(normalized);
    artifacts.push(normalized);
  }
  for (const view of byId.values()) {
    if (view.taskId !== task.id) continue;
    if (seen.has(view.id)) continue;
    seen.add(view.id);
    artifacts.push(view.id);
  }

  return {
    ...task,
    artifacts,
    blocks: resolveBlocks(task.blocks, ctx),
    runs: task.runs.map((run) => ({ ...run, blocks: resolveBlocks(run.blocks, ctx) })),
  };
}

/** Resolves the producer-authored blocks attached to one artifact node. */
export function resolveArtifactBlocks(
  blocks: Block[] | undefined,
  ctx: BlockContext,
): Block[] | undefined {
  return resolveBlocks(blocks, ctx);
}
