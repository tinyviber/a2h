import { basename } from 'node:path';
import { readFileNoFollow, readHeadNoFollow } from '../util/safeRead';
import type { FileEntry, WorkspaceIdentity } from '../types';

// Derives a human-facing identity for the workspace without requiring a
// strict schema: name and one-line summary are sourced from whatever is
// actually present (README heading, package.json, directory name).

const README_NAMES = new Set([
  'readme.md', 'readme.markdown', 'readme.mdown', 'readme.txt',
  'readme.mdx', 'readme.rst', 'readme',]);

const MAX_READ_BYTES = 64 * 1024;

function findReadme(files: FileEntry[]): FileEntry | undefined {
  const candidates = files
    .filter((f) => f.kind === 'markdown' || f.kind === 'other')
    .filter((f) => README_NAMES.has(f.path.split('/').pop()!.toLowerCase()))
    .sort((a, b) => a.depth - b.depth || a.path.length - b.path.length);
  return candidates[0];
}

function readHead(absPath: string): string {
  return readHeadNoFollow(absPath, MAX_READ_BYTES) ?? '';
}

interface Heading {
  title?: string;
  summary?: string;
}

function extractHeading(md: string): Heading {
  const lines = md.split(/\r?\n/);
  let title: string | undefined;
  let summary: string | undefined;

  let inTitle = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!title) {
      const h1 = line.match(/^#\s+(.+)$/);
      if (h1) {
        title = h1[1]!.replace(/[`*_~]/g, '').trim();
        inTitle = true;
        continue;
      }
      // Skip frontmatter delimiters and html comments before a title.
      if (line === '---' || line === '+++' || line.startsWith('<!--') || line === '') continue;
    } else if (inTitle) {
      // Find the first prose paragraph after the title.
      if (line.startsWith('#') || line.startsWith('```') || line.startsWith('>') || line.startsWith('|')) {
        continue;
      }
      if (line === '') continue;
      if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('1. ')) break;
      summary = line.replace(/[`*_]/g, '').trim();
      break;
    }
  }

  if (summary && summary.length > 200) summary = summary.slice(0, 197) + '…';
  return { title, summary };
}

/** Enough for any real package.json; enough to stop a pathological one. */
const MAX_PACKAGE_JSON_BYTES = 256 * 1024;

function readPackageJson(rootDir: string): { name?: string; description?: string } {
  // A workspace file like any other: read through the no-follow primitive, so
  // a `package.json` that is a link to something outside contributes nothing,
  // and a huge one cannot be used to make startup expensive.
  const read = readFileNoFollow(`${rootDir}/package.json`, MAX_PACKAGE_JSON_BYTES);
  if (!read) return {};
  try {
    const pkg = JSON.parse(read.text) as Record<string, unknown>;
    return {
      name: typeof pkg.name === 'string' ? pkg.name : undefined,
      description: typeof pkg.description === 'string' ? pkg.description : undefined,
    };
  } catch {
    return {};
  }
}

export function deriveIdentity(rootDir: string, files: FileEntry[]): WorkspaceIdentity {
  const readme = findReadme(files);
  const heading = readme ? extractHeading(readHead(readme.absolutePath)) : {};
  const pkg = readPackageJson(rootDir);

  const name = heading.title || pkg.name || prettifyDirName(basename(rootDir));
  const summary = heading.summary || pkg.description;

  return { name, summary };
}

function prettifyDirName(dirName: string): string {
  // "my-cool-repo" -> "my cool repo"
  return dirName.replace(/[-_]+/g, ' ').trim();
}
