import MarkdownIt from 'markdown-it';
import { isSafeLinkHref, isWorkspaceRelative } from '../security/urlPolicy';

// Markdown rendering is deliberately conservative:
//   - raw HTML is escaped, never executed (`html: false`)
//   - link protocols are validated (no javascript:/data:/vbscript:)
//   - relative image srcs are rewritten through a caller-provided resolver
// The resolver is supplied by the content layer, which validates that the
// target file really exists inside the workspace before producing a URL.

/**
 * The workspace's single URL policy, shared with the block renderer so a
 * producer cannot get a laxer answer out of one path than the other.
 */
export const isSafeUrl = isSafeLinkHref;

export type ImageResolver = (src: string) => string | undefined;

export function renderMarkdown(mdText: string, resolveImage?: ImageResolver): string {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: false,
  });

  md.validateLink = isSafeUrl;

  if (resolveImage) {
    const defaultImage = md.renderer.rules.image;
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx]!;
      const srcIdx = token.attrIndex('src');
      if (srcIdx < 0) return defaultImage ? defaultImage(tokens, idx, options, env, self) : '';
      const rawSrc = token.attrs![srcIdx]![1] as string;

      // Only a plain workspace-relative src is rewritten. Anything with a
      // scheme, and anything protocol-relative, is left to the default rule —
      // which the page's `img-src 'self' data:` then refuses to load, so a
      // workspace cannot make the viewer fetch a remote pixel.
      if (isWorkspaceRelative(rawSrc)) {
        const resolved = resolveImage(rawSrc);
        if (resolved) {
          token.attrs![srcIdx]![1] = resolved;
        } else {
          // Broken / unresolvable local image — render as plain alt text.
          const alt = token.content || '';
          return `<span class="a2h-img-missing">${md.utils.escapeHtml(alt || 'image')}</span>`;
        }
      }
      return defaultImage ? defaultImage(tokens, idx, options, env, self) : '';
    };
  }

  return md.render(mdText);
}

export interface FrontmatterResult {
  frontmatter?: Record<string, unknown>;
  body: string;
}

/** Extracts simple YAML-style frontmatter (key: value) from the top of a doc. */
export function splitFrontmatter(text: string): FrontmatterResult {
  if (!text.startsWith('---')) return { body: text };
  const lines = text.split(/\r?\n/);
  // Skip the opening '---'
  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closeIdx === -1) return { body: text };

  const fm: Record<string, unknown> = {};
  for (let i = 1; i < closeIdx; i++) {
    const line = lines[i]!;
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (m) {
      const key = m[1]!;
      let value: unknown = m[2]!.trim();
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (value === 'null' || value === '~') value = null;
      else if (/^-?\d+(\.\d+)?$/.test(value as string)) value = Number(value);
      else if (
        (value as string).startsWith('"') && (value as string).endsWith('"')
      ) value = (value as string).slice(1, -1);
      fm[key] = value;
    }
  }
  const body = lines.slice(closeIdx + 1).join('\n');
  return { frontmatter: fm, body };
}
