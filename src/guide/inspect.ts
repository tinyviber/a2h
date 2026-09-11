import { basename } from 'node:path';
import { classifyFile } from '../scanner/classify';
import type { LoadedSemantics } from '../semantics/types';
import type { ScanResult } from '../types';
import { readFileNoFollow } from '../util/safeRead';
import type { BucketId, DirectoryBucket, ProjectProfile } from './types';

// ---------------------------------------------------------------------------
// Inspection: workspace -> ProjectProfile.
//
// Everything here is derived from directory names, file names, extensions, and
// sizes the scanner already recorded. No file body is read — with one narrow
// exception, `package.json`, and then only its `name` field, and only when the
// manifest and the directory both decline to name the project.
//
// In particular `.env` and every other credential-like file is classified by
// the scanner and then *never opened*. A guide that leaked a token into a file
// an agent will read would be the exact failure this whole layer exists to
// prevent.
// ---------------------------------------------------------------------------

/**
 * The directory conventions, in priority order. A file belongs to the first
 * convention that matches its top-level directory *or* its extension, so a
 * directory named in two lists is claimed once, by the earlier one.
 */
interface Convention {
  id: BucketId;
  label: string;
  dirs: string[];
  extensions?: string[];
}

const CONVENTIONS: Convention[] = [
  { id: 'source', label: 'source', dirs: ['src', 'lib', 'app', 'packages', 'apps'] },
  { id: 'tests', label: 'tests', dirs: ['test', 'tests', '__tests__', 'spec'] },
  { id: 'docs', label: 'docs', dirs: ['docs', 'doc', 'spec', 'specs'] },
  { id: 'data', label: 'data', dirs: ['data', 'dataset', 'datasets', 'corpus'] },
  {
    id: 'outputs',
    label: 'outputs',
    dirs: ['output', 'outputs', 'result', 'results', 'generated', 'views', 'artifacts'],
  },
  { id: 'reports', label: 'reports', dirs: ['report', 'reports', 'analysis', 'research'] },
  { id: 'logs', label: 'logs', dirs: ['logs'], extensions: ['log'] },
  { id: 'patches', label: 'patches', dirs: ['patches', 'diffs'], extensions: ['diff', 'patch'] },
  { id: 'images', label: 'images', dirs: ['screenshots', 'images', 'assets'] },
];

/** Extensions that mean "a corpus lives here", whatever else is around them. */
const STRUCTURED_DATA_EXTS = new Set(['jsonl', 'ndjson', 'sqlite', 'sqlite3', 'db']);

/** A JSON file this large is a dataset by any reasonable reading. */
const LARGE_JSON_BYTES = 256 * 1024;

const MAX_DOMINANT_LANGUAGES = 3;

/** Bounded, and `name` only: the rest of the file is none of our business. */
const MAX_PACKAGE_JSON_BYTES = 64 * 1024;

export function inspectProject(scan: ScanResult, loaded: LoadedSemantics): ProjectProfile {
  const files = scan.files;

  const buckets = collectBuckets(files);
  const bucketIds = new Set(buckets.map((b) => b.id));

  const codeFiles = files.filter((f) => f.kind === 'code' && !f.isSymlink);
  const markdownFiles = files.filter((f) => f.kind === 'markdown' && !f.isSymlink);
  const total = files.length || 1;

  const structuredData = files.some(
    (f) =>
      STRUCTURED_DATA_EXTS.has(f.ext) ||
      (f.ext === 'json' && f.size >= LARGE_JSON_BYTES),
  );

  const codeShare = codeFiles.length / total;
  const markdownShare = markdownFiles.length / total;

  return {
    name: projectName(scan, loaded),
    hasManifest: loaded.manifest !== undefined,
    hasAgentsMd: files.some((f) => f.path.toLowerCase() === 'agents.md'),
    hasSensitiveFiles: files.some((f) => f.sensitive),
    dominantLanguages: dominantLanguages(codeFiles.map((f) => f.path)),
    buckets,
    traits: {
      codeHeavy: bucketIds.has('source') || (codeFiles.length >= 3 && codeShare >= 0.5),
      dataHeavy: bucketIds.has('data') || structuredData,
      documentHeavy: markdownFiles.length >= 3 && markdownShare >= 0.5,
      hasGeneratedOutputs: bucketIds.has('outputs'),
      hasTests: bucketIds.has('tests'),
    },
    fileCount: files.length,
  };
}

/**
 * Groups files into the conventions that actually matched.
 *
 * Both halves matter: the *label* is what the guide says out loud, and the
 * *matches* are the evidence for it. A bucket with no matches is not emitted at
 * all, so the guide never lists a directory that is not there.
 */
function collectBuckets(files: ScanResult['files']): DirectoryBucket[] {
  const matches = new Map<BucketId, Set<string>>();

  for (const file of files) {
    const top = file.path.includes('/') ? file.path.slice(0, file.path.indexOf('/')) : '';
    const convention = CONVENTIONS.find(
      (c) =>
        (top !== '' && c.dirs.includes(top)) ||
        (file.ext !== '' && (c.extensions?.includes(file.ext) ?? false)),
    );
    if (!convention) continue;

    const set = matches.get(convention.id) ?? new Set<string>();
    // Directories read as `dir/`; extension hits as `*.ext`, so a reader can
    // tell a convention from a single stray file.
    const token = top !== '' && convention.dirs.includes(top) ? `${top}/` : `*.${file.ext}`;
    set.add(token);
    matches.set(convention.id, set);
  }

  return CONVENTIONS.filter((c) => matches.has(c.id)).map((c) => ({
    id: c.id,
    label: c.label,
    matches: [...matches.get(c.id)!].sort(),
  }));
}

/**
 * Language names for the code in the workspace, most common first.
 *
 * Ties break alphabetically so the list is stable across platforms and
 * directory-listing orders. Only languages the scanner recognises and only
 * files it classified as code — a Markdown-heavy repository should not report
 * "Markdown" as a programming language.
 */
function dominantLanguages(paths: string[]): string[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const slash = path.lastIndexOf('/');
    const name = slash === -1 ? path : path.slice(slash + 1);
    const { language } = classifyFile(name);
    if (!language) continue;
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_DOMINANT_LANGUAGES)
    .map(([language]) => language);
}

/**
 * A name for the project, in the order that respects who is speaking: the
 * producer's own manifest, then the directory it lives in, then the package
 * metadata if the directory is anonymous.
 */
function projectName(scan: ScanResult, loaded: LoadedSemantics): string {
  const declared = loaded.name?.trim();
  if (declared) return declared;

  const dir = basename(scan.rootDir).trim();
  if (dir && dir !== '.' && dir !== '/') return dir;

  const read = readFileNoFollow(`${scan.rootDir}/package.json`, MAX_PACKAGE_JSON_BYTES);
  if (read) {
    try {
      const pkg = JSON.parse(read.text) as Record<string, unknown>;
      if (typeof pkg.name === 'string' && pkg.name.trim()) return pkg.name.trim();
    } catch {
      /* an unreadable package.json names nothing */
    }
  }
  return 'this workspace';
}
