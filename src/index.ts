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

// Server
export { Workspace } from './server/workspace';
export { createA2hServer, findAssetsDir } from './server/server';
export { resolveRelPath, resolveRealPath, isWithin } from './server/safePath';

// Content
export { renderContent } from './renderer/content';
export { renderMarkdown, isSafeUrl, splitFrontmatter } from './parsers/markdown';
export { parseDiff } from './parsers/diff';
export { parseJson } from './parsers/json';
export { parseLog } from './parsers/log';
export { parseCode } from './parsers/code';

export { normalizeRel } from './util/path';
export type * from './types';
