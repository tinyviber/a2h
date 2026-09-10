// Path helpers that are used by both the renderer (image resolution) and the
// server (route safety). They produce workspace-relative POSIX paths and
// reject anything that would escape the workspace root.

/**
 * Normalizes a POSIX relative path, resolving "." and ".." segments.
 * Returns null if the path escapes the root (i.e. climbs above it).
 */
export function normalizeRel(p: string): string | null {
  const segs: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (segs.length === 0) return null;
      segs.pop();
    } else {
      segs.push(seg);
    }
  }
  return segs.join('/');
}

/**
 * Joins a base directory with a relative path and normalizes the result.
 * Returns null if the result escapes the workspace root.
 */
export function joinRel(baseDir: string, rel: string): string | null {
  return normalizeRel(baseDir ? `${baseDir}/${rel}` : rel);
}
