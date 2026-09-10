// Formatting + label vocabularies. Everything a human reads about a piece of
// content is named here, so the visual language stays consistent.

export const KIND_LABEL = {
  readme: 'Overview',
  report: 'Report',
  markdown: 'Note',
  code: 'Code',
  json: 'Data',
  log: 'Log',
  diff: 'Diff',
  image: 'Image',
  file: 'File',
};

export const SOURCE_LABEL = {
  explicit: 'declared',
  frontmatter: 'frontmatter',
  convention: 'by convention',
  heuristic: 'inferred',
};

/**
 * Noun form, for sentences like "declared in the manifest". SOURCE_LABEL reads
 * as an adjective and produced "declared by declared".
 */
export const SOURCE_ORIGIN = {
  explicit: 'the manifest',
  frontmatter: 'frontmatter',
  convention: 'convention',
  heuristic: 'inference',
};

const STATUS_LABEL = {
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  partial: 'Partial',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
  info: 'Info',
};

const STATUS_TONE = {
  pending: 'neutral',
  running: 'info',
  succeeded: 'good',
  failed: 'bad',
  partial: 'warn',
  blocked: 'warn',
  cancelled: 'neutral',
  info: 'neutral',
};

export function statusLabel(status) {
  if (!status) return 'Unknown';
  return STATUS_LABEL[status] || prettify(status);
}

export function statusTone(status) {
  return STATUS_TONE[status] || 'neutral';
}

/** Producer-defined roles/statuses get a readable label instead of raw slugs. */
export function prettify(value) {
  return String(value == null ? '' : value)
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function kindLabel(kind) {
  return KIND_LABEL[kind] || prettify(kind);
}

export function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function relTime(ms) {
  if (!ms) return '';
  let diff = Date.now() - ms;
  if (diff < 0) diff = 0;
  if (diff < 60 * 1000) return 'just now';
  if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 24 * 3600 * 1000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 7 * 24 * 3600 * 1000) return `${Math.floor(diff / (24 * 3600000))}d ago`;
  return new Date(ms).toLocaleDateString();
}

/** ISO strings come from producers; render them compactly and locally. */
export function fmtStamp(value) {
  if (!value) return '';
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return String(value);
  const diff = Date.now() - ms;
  if (diff >= 0 && diff < 7 * 24 * 3600 * 1000) return relTime(ms);
  return new Date(ms).toLocaleString();
}

export function fmtDuration(ms) {
  if (ms == null) return '';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Paths are shown, not linked, unless there is somewhere to go. */
export function shortPath(path) {
  if (!path) return '';
  return path.length > 72 ? `…${path.slice(-69)}` : path;
}
