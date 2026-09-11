// Public programmatic API. The CLI (bin/a2h.js) is the primary entry point,
// but these exports keep every layer testable and composable.

// Scanner
export { scanWorkspace } from './scanner/scan';
export { classifyFile } from './scanner/classify';

// Semantics (the producer protocol)
export { loadSemantics, hasExplicitSemantics, readFrontmatterSemantics } from './semantics/load';
export { resolveSemantics } from './semantics/resolve';
export type { Manifest, ItemSpec, TaskSpec, RunSpec, ActionSpec, GroupSpec } from './semantics/types';

// Semantic IR + presentation IR
export { buildSemanticIR, hash } from './ir/build';
export { present } from './presentation/present';
export { resolveBlocks } from './presentation/blocks';

// Action layer
export { ActionEngine } from './actions/engine';
export { createDefaultRegistry, createMockExecutor } from './providers/registry';
export type { ActionExecutor, ProviderRegistry } from './providers/types';
// The durable decision log: a writer (the engine uses it) and the file shape.
export { writeDecisionRecord, decisionFileName, DECISIONS_DIR } from './actions/decisions';

// CLI-reachable checks that are also useful programmatically.
export { validateWorkspace } from './cli/validate';
export type { ValidateReport } from './cli/validate';

// The other direction: A2H -> Agent. `a2h guide` writes project-aware producer
// guidance the project's own coding agent may merge into its own rules. Nothing
// here is protocol input, and nothing here writes AGENTS.md.
export { inspectProject } from './guide/inspect';
export { generateGuide, AGENT_GUIDE_PATH, AGENT_GUIDE_MARKER } from './guide/generate';
export { writeGuide } from './guide/write';
export type { ProjectProfile, DirectoryBucket, ProjectTraits, BucketId } from './guide/types';
// The writer guide builds on, and the one future manifest/run writers should
// reuse: containment-checked, symlink-refusing, temp-file-and-rename.
export { writeWorkspaceFile } from './security/writeWorkspaceFile';
export type { WriteWorkspaceFileOptions, WriteWorkspaceFileResult } from './security/writeWorkspaceFile';

// Server
export { Workspace } from './server/workspace';
export { createA2hServer, findAssetsDir } from './server/server';
// Security boundary
export { resolveRelPath, resolveRealPath, isWithin } from './security/boundary';
export { createWorkspaceReader } from './security/workspaceRead';
export type { WorkspaceReader } from './security/workspaceRead';
// One URL policy for markdown, blocks and anything that becomes an href.
export { isSafeLinkHref, isWorkspaceRelative } from './security/urlPolicy';

// Content
export { renderContent } from './renderer/content';
export { renderMarkdown, isSafeUrl, splitFrontmatter } from './parsers/markdown';
export { parseDiff } from './parsers/diff';
export { parseJson } from './parsers/json';
export { parseLog } from './parsers/log';
export { parseCode } from './parsers/code';

export { normalizeRel } from './util/path';
export type * from './types';
