import type { ArtifactPayload, ArtifactView, Presentation, SemanticIR } from '../types';
import { scanWorkspace } from '../scanner/scan';
import { buildSemanticIR } from '../ir/build';
import { present } from '../presentation/present';
import { renderContent } from '../renderer/content';
import type { FileEntry } from '../types';

// The Workspace model ties scan -> IR -> presentation together and exposes the
// lookups the server needs. Rescanning (for watch mode) rebuilds all three
// layers from a fresh scan.

export class Workspace {
  rootDir: string;
  scan: ReturnType<typeof scanWorkspace>;
  ir: SemanticIR;
  presentation: Presentation;
  private filesByPath: Map<string, FileEntry> = new Map();
  private viewsByPath: Map<string, ArtifactView> = new Map();
  private knownImages: Set<string> = new Set();
  /** Incremented on every (re)scan; used as the change signal for watch. */
  version = 0;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.scan = scanWorkspace({ rootDir });
    this.ir = buildSemanticIR(this.scan);
    this.presentation = present(this.ir);
    this.rebuildIndexes();
  }

  private rebuildIndexes(): void {
    this.filesByPath = new Map(this.scan.files.map((f) => [f.path, f]));
    this.viewsByPath = new Map();
    for (const s of this.presentation.sections) {
      for (const a of s.artifacts) this.viewsByPath.set(a.id, a);
    }
    this.knownImages = new Set(
      this.scan.files.filter((f) => f.kind === 'image').map((f) => f.path),
    );
  }

  rescan(): void {
    this.scan = scanWorkspace({ rootDir: this.rootDir });
    this.ir = buildSemanticIR(this.scan);
    this.presentation = present(this.ir);
    this.rebuildIndexes();
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

  renderPayload(path: string, mode?: 'tail' | 'full'): ArtifactPayload | undefined {
    const entry = this.filesByPath.get(path);
    const view = this.viewsByPath.get(path);
    if (!entry || !view) return undefined;
    const content = renderContent(entry, view.kind, {
      rootDir: this.rootDir,
      knownImages: this.knownImages,
      fileUrl: (p) => this.fileUrl(p),
    }, mode);
    return {
      id: view.id,
      title: view.title,
      kind: view.kind,
      path: view.path,
      summary: view.summary,
      meta: view.meta,
      tags: view.tags,
      content,
    };
  }
}
