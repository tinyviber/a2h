import type {
  ArtifactPayload,
  ArtifactView,
  Block,
  FileEntry,
  Presentation,
  SemanticIR,
  SemanticNode,
} from '../types';
import { scanWorkspace } from '../scanner/scan';
import { buildSemanticIR } from '../ir/build';
import { present, resolveArtifactBlocks } from '../presentation/present';
import type { BlockContext } from '../presentation/blocks';
import { renderContent } from '../renderer/content';
import { loadSemantics } from '../semantics/load';
import { resolveSemantics, type ResolvedSemantics } from '../semantics/resolve';
import { ActionEngine } from '../actions/engine';
import { createDefaultRegistry } from '../providers/registry';
import type { ProviderRegistry } from '../providers/types';

// The Workspace model ties scan -> semantics -> IR -> presentation together and
// exposes the lookups the server needs.
//
// Two pieces of state deliberately survive a rescan:
//   - the action engine (and its audit trail), because watch-mode rescans must
//     not erase what the human just did;
//   - nothing else. Everything derived from disk is rebuilt from scratch.

export interface WorkspaceOptions {
  rootDir: string;
  registry?: ProviderRegistry;
  now?: () => Date;
}

export class Workspace {
  rootDir: string;
  scan: ReturnType<typeof scanWorkspace>;
  semantics: ResolvedSemantics;
  ir: SemanticIR;
  readonly engine: ActionEngine;
  readonly registry: ProviderRegistry;

  /** What is on disk, before any action the human took this session. */
  private base: Presentation;

  private filesByPath: Map<string, FileEntry> = new Map();
  private viewsByPath: Map<string, ArtifactView> = new Map();
  private nodesByPath: Map<string, SemanticNode> = new Map();
  private knownImages: Set<string> = new Set();

  /** Incremented on every (re)scan; used as the change signal for watch. */
  version = 0;

  /**
   * The presentation the UI sees: disk-derived structure with this session's
   * action state (run records, task status, audit trail) overlaid. Computed on
   * read so an action result is visible without a rescan.
   */
  get presentation(): Presentation {
    return this.applyRuntimeState(this.base);
  }

  constructor(options: WorkspaceOptions | string) {
    const opts: WorkspaceOptions = typeof options === 'string' ? { rootDir: options } : options;
    this.rootDir = opts.rootDir;
    this.registry = opts.registry ?? createDefaultRegistry();
    this.engine = new ActionEngine({
      rootDir: this.rootDir,
      registry: this.registry,
      now: opts.now,
    });

    // Placeholder values so the fields are always defined before rebuild().
    this.scan = { rootDir: this.rootDir, identity: { name: '' }, git: { isRepo: false }, files: [], ignored: [], warnings: [] };
    this.semantics = {
      origin: 'inferred',
      items: new Map(),
      groups: [],
      tasks: [],
      runs: [],
      actions: [],
      warnings: [],
    };
    this.ir = {
      id: '',
      identity: { name: '' },
      git: { isRepo: false },
      stats: { files: 0, artifacts: 0, ignored: 0, bytes: 0 },
      semantics: 'inferred',
      root: { id: 'workspace', type: 'workspace', title: '', priority: 0, children: [] },
      warnings: [],
    };
    this.base = {
      identity: { name: '' },
      git: { isRepo: false },
      stats: { files: 0, artifacts: 0, ignored: 0, bytes: 0 },
      semantics: 'inferred',
      simulatedActions: false,
      highlights: [],
      sections: [],
      tasks: [],
      runs: [],
      actions: [],
      panels: [],
      audit: [],
      warnings: [],
    };

    this.rebuild();
  }

  rescan(): void {
    this.rebuild();
    this.version += 1;
  }

  fileUrl(relPath: string): string {
    return `/api/file?path=${encodeURIComponent(relPath)}`;
  }

  getFile(path: string): FileEntry | undefined {
    return this.filesByPath.get(path);
  }

  getView(path: string): ArtifactView | undefined {
    return this.viewsByPath.get(path);
  }

  /** The action registry as published to the client (the execution allowlist). */
  declaredActions() {
    return this.base.actions;
  }

  renderPayload(path: string, mode?: 'tail' | 'full'): ArtifactPayload | undefined {
    const entry = this.filesByPath.get(path);
    const view = this.viewsByPath.get(path);
    if (!entry || !view) return undefined;

    const content = renderContent(
      entry,
      {
        rootDir: this.rootDir,
        knownImages: this.knownImages,
        fileUrl: (p) => this.fileUrl(p),
      },
      mode,
    );

    const node = this.nodesByPath.get(path);
    const blocks: Block[] | undefined = resolveArtifactBlocks(node?.blocks, this.blockContext());

    return {
      id: view.id,
      title: view.title,
      kind: view.kind,
      path: view.path,
      summary: view.summary,
      meta: view.meta,
      tags: view.tags,
      content,
      blocks,
      relations: view.relations,
      taskId: view.taskId,
    };
  }

  private blockContext(): BlockContext {
    return {
      rootDir: this.rootDir,
      resolveImage: (rel) => (this.knownImages.has(rel) ? this.fileUrl(rel) : undefined),
    };
  }

  // -------------------------------------------------------------------------

  private rebuild(): void {
    const scan = scanWorkspace({ rootDir: this.rootDir });
    this.scan = scan;

    this.knownImages = new Set(
      scan.files.filter((f) => f.kind === 'image' && !f.isSymlink).map((f) => f.path),
    );

    // Only plain markdown is inspected for producer frontmatter.
    const markdownPaths = scan.files
      .filter((f) => f.kind === 'markdown' && !f.isSymlink && !f.sensitive)
      .map((f) => f.path);

    const loaded = loadSemantics(this.rootDir, { markdownPaths });
    const semantics = resolveSemantics(loaded, {
      simulatedActions: this.registry.simulated,
    });
    this.semantics = semantics;

    const ir = buildSemanticIR(scan, { semantics });
    this.ir = ir;

    const presentation = present(ir, {
      semantics,
      blockContext: this.blockContext(),
    });

    this.base = presentation;

    // ---- indexes ----------------------------------------------------------
    this.filesByPath = new Map(scan.files.map((f) => [f.path, f]));
    this.viewsByPath = new Map();
    for (const s of presentation.sections) {
      for (const a of s.artifacts) this.viewsByPath.set(a.id, a);
    }
    this.nodesByPath = new Map();
    collectNodes(this.ir.root, this.nodesByPath);
  }

  /**
   * Overlays state produced by executed actions on top of the disk-derived
   * presentation: new runs, task status changes, and the session audit trail.
   */
  private applyRuntimeState(base: Presentation): Presentation {
    const runtimeRuns = this.engine.getRuntimeRuns();
    const audit = this.engine.getAuditTrail();

    if (runtimeRuns.length === 0 && audit.length === 0) return base;

    const tasks = base.tasks.map((task) => {
      const overridden = this.engine.getTaskStatus(task.id);
      const own = runtimeRuns.filter((r) => r.taskId === task.id);
      if (!overridden && own.length === 0) return task;
      return {
        ...task,
        status: overridden ?? task.status,
        runs: [...own, ...task.runs],
      };
    });

    return {
      ...base,
      tasks,
      runs: runtimeRuns.length ? [...runtimeRuns, ...base.runs] : base.runs,
      audit,
    };
  }
}

function collectNodes(node: SemanticNode, into: Map<string, SemanticNode>): void {
  if (node.type === 'artifact' && node.path) into.set(node.path, node);
  for (const child of node.children) collectNodes(child, into);
}
