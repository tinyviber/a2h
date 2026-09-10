import type {
  ArtifactView,
  Presentation,
  SectionKind,
  SectionView,
  SemanticIR,
  SemanticNode,
} from '../types';

// Presentation layer: maps the semantic IR into the final ordered view the
// renderer consumes. This is the third tree — ordering, "what to read first",
// and section descriptions live here, not in the IR.

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

function toView(node: SemanticNode): ArtifactView {
  return {
    id: node.id,
    title: node.title,
    kind: node.kind!,
    path: node.path,
    summary: node.summary,
    meta: node.meta,
    tags: node.tags,
    priority: node.priority,
  };
}

export function present(ir: SemanticIR): Presentation {
  const sections: SectionView[] = ir.root.children.map((section) => ({
    id: section.id,
    title: section.title,
    kind: section.id as SectionKind,
    description: SECTION_DESCRIPTIONS[section.id as SectionKind],
    artifacts: section.children.map(toView),
  }));

  const allArtifacts = sections.flatMap((s) => s.artifacts);
  const nonReadme = allArtifacts.filter((a) => a.kind !== 'readme');
  nonReadme.sort((a, b) => b.priority - a.priority || (b.meta?.mtimeMs ?? 0) - (a.meta?.mtimeMs ?? 0));
  const highlights = nonReadme.slice(0, MAX_HIGHLIGHTS);

  return {
    identity: ir.identity,
    git: ir.git,
    stats: ir.stats,
    highlights,
    sections,
    warnings: ir.warnings,
  };
}
