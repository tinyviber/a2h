import type { ContentKind, FileKind } from '../types';

// Extension-based classification. Deterministic and convention-driven; the
// semantic IR layer adds meaning on top of these broad categories.

const MARKDOWN_EXTS = new Set([
  'md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdx', 'rst',
]);

const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'go', 'rs', 'java', 'c', 'cc', 'cpp', 'cxx', 'h', 'hh', 'hpp',
  'cs', 'rb', 'php', 'swift', 'kt', 'kts', 'scala', 'dart', 'lua',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'sql', 'graphql', 'gql',
  'html', 'htm', 'css', 'scss', 'sass', 'less', 'styl',
  'vue', 'svelte', 'astro',
  'yaml', 'yml', 'toml', 'xml', 'proto', 'nim',
  'el', 'ex', 'exs', 'clj', 'cljs', 'erl', 'hrl', 'hs', 'fs', 'fsx',
]);

const JSON_EXTS = new Set(['json', 'jsonc', 'geojson', 'jsonl', 'ndjson', 'ipynb']);

const LOG_EXTS = new Set(['log', 'out']);

const DIFF_EXTS = new Set(['diff', 'patch']);

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'tif', 'tiff',
]);

const BINARY_EXTS = new Set([
  'pdf', 'zip', 'gz', 'tgz', 'tar', '7z', 'rar',
  'exe', 'dll', 'so', 'dylib', 'o', 'a', 'class', 'jar', 'war', 'bin',
  'dat', 'db', 'sqlite', 'sqlite3',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'mov', 'avi', 'mkv', 'wav', 'flac', 'webm', 'wasm',
  'pyc', 'dmg', 'iso', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt',
]);

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', go: 'Go', rs: 'Rust', java: 'Java',
  c: 'C', cc: 'C++', cpp: 'C++', cxx: 'C++', h: 'C', hh: 'C++', hpp: 'C++',
  cs: 'C#', rb: 'Ruby', php: 'PHP', swift: 'Swift', kt: 'Kotlin', kts: 'Kotlin',
  scala: 'Scala', dart: 'Dart', lua: 'Lua',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', fish: 'Shell', ps1: 'PowerShell', bat: 'Batch', cmd: 'Batch',
  sql: 'SQL', graphql: 'GraphQL', gql: 'GraphQL',
  html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', sass: 'Sass', less: 'Less', styl: 'Stylus',
  vue: 'Vue', svelte: 'Svelte', astro: 'Astro',
  yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML', proto: 'Protobuf', nim: 'Nim',
  el: 'Elixir', ex: 'Elixir', exs: 'Elixir', clj: 'Clojure', cljs: 'ClojureScript',
  erl: 'Erlang', hrl: 'Erlang', hs: 'Haskell', fs: 'F#', fsx: 'F#',
};

/** Filenames whose content should not be previewed (secrets / credentials). */
const SENSITIVE_PATTERNS = [
  /^\.env(\..*)?$/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /^id_rsa($|\.)/,
  /^id_dsa($|\.)/,
  /credential/i,
  /secret/i,
  /token/i,
];

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

export interface Classification {
  kind: FileKind;
  language?: string;
  sensitive: boolean;
}

export function classifyFile(name: string): Classification {
  const base = name.toLowerCase();
  const ext = extensionOf(base);

  // Filename-driven overrides take precedence over extension.
  if (base === 'readme.md' || base === 'readme.markdown' || base === 'readme') {
    return { kind: 'markdown', language: 'Markdown', sensitive: false };
  }
  if (/\.(diff|patch)$/.test(base)) {
    return { kind: 'diff', sensitive: false };
  }

  const sensitive = SENSITIVE_PATTERNS.some((re) => re.test(base));

  if (MARKDOWN_EXTS.has(ext)) return { kind: 'markdown', language: 'Markdown', sensitive };
  if (DIFF_EXTS.has(ext)) return { kind: 'diff', sensitive };
  if (LOG_EXTS.has(ext)) return { kind: 'log', sensitive };
  if (JSON_EXTS.has(ext)) return { kind: 'json', language: 'JSON', sensitive };
  if (IMAGE_EXTS.has(ext)) return { kind: 'image', sensitive };
  if (BINARY_EXTS.has(ext)) return { kind: 'binary', sensitive };
  if (CODE_EXTS.has(ext)) return { kind: 'code', language: LANGUAGE_BY_EXT[ext], sensitive };

  return { kind: 'other', sensitive };
}

/** True for content we treat as image previews. */
export function isImageExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase());
}

/**
 * Maps the scanner's broad file kind onto the way the content should be drawn.
 * Everything the renderer has no special handling for degrades to "file", which
 * is the safe default (hex/text preview, or a binary notice).
 */
export function contentKindOf(kind: FileKind): ContentKind {
  switch (kind) {
    case 'markdown': return 'markdown';
    case 'diff': return 'diff';
    case 'json': return 'json';
    case 'log': return 'log';
    case 'image': return 'image';
    case 'code': return 'code';
    default: return 'file';
  }
}
