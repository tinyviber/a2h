// ---------------------------------------------------------------------------
// The shape `a2h guide` inspects a workspace down to.
//
// This is deliberately small and entirely derived from *names*: file names,
// extensions, directory conventions, sizes, and the presence of two marker
// files. Nothing here reads a file body, and nothing here guesses a framework —
// a guide that claims "this is a Next.js app" from a directory listing is worse
// than one that says nothing, because a human will believe it.
//
// The profile is the only input to `generateGuide`, which is what makes the
// output deterministic: same workspace, same bytes.
// ---------------------------------------------------------------------------

export type BucketId =
  | 'source'
  | 'tests'
  | 'docs'
  | 'data'
  | 'outputs'
  | 'reports'
  | 'logs'
  | 'patches'
  | 'images';

/** A directory convention that actually matched, with what matched it. */
export interface DirectoryBucket {
  id: BucketId;
  /** Short label, used verbatim on stdout and in the guide. */
  label: string;
  /**
   * Workspace-relative directories or file patterns that matched, sorted.
   * Directory names and coarse traits only — never file contents.
   */
  matches: string[];
}

export interface ProjectTraits {
  /** Source directories exist, or code files dominate the scan. */
  codeHeavy: boolean;
  /** A data/corpus directory exists, or the scan sees database-like files. */
  dataHeavy: boolean;
  /** Markdown dominates what is here. */
  documentHeavy: boolean;
  /** Something in the workspace looks like generated output. */
  hasGeneratedOutputs: boolean;
  /** A test convention is present. */
  hasTests: boolean;
}

export interface ProjectProfile {
  /** manifest.name, else the directory name, else package.json's name. */
  name: string;
  hasManifest: boolean;
  hasAgentsMd: boolean;
  /**
   * The scanner classified at least one file as credential-like. The guide may
   * say so; it never names the file or copies a byte.
   */
  hasSensitiveFiles: boolean;
  /** Friendlier language names, most files first. Capped and sorted. */
  dominantLanguages: string[];
  /** Only the conventions that matched. */
  buckets: DirectoryBucket[];
  traits: ProjectTraits;
  /** Files the scanner indexed, for "this workspace is thin" wording. */
  fileCount: number;
}
