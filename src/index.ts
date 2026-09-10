// Public programmatic API. The CLI (bin/a2h.js) is the primary entry point,
// but these exports keep the pipeline testable and composable.

export { scanWorkspace } from './scanner/scan';
export { classifyFile } from './scanner/classify';
export { buildSemanticIR, hash } from './ir/build';
export { present } from './presentation/present';
export { Workspace } from './server/workspace';
export { createA2hServer, findAssetsDir } from './server/server';
export { renderContent } from './renderer/content';
export { renderMarkdown, isSafeUrl, splitFrontmatter } from './parsers/markdown';
export { parseDiff } from './parsers/diff';
export { parseJson } from './parsers/json';
export { parseLog } from './parsers/log';
export { parseCode } from './parsers/code';
export { resolveRelPath, resolveRealPath } from './server/safePath';
export { normalizeRel } from './util/path';
export type * from './types';
