import MarkdownIt from 'markdown-it';
import katex from 'katex';
import texmath from 'markdown-it-texmath';
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

/**
 * Returns escaped HTML (or a complete `<pre>` wrapper) for a fenced code block.
 * The callback is deliberately optional: language classes are still emitted
 * when no highlighter is configured, so the renderer does not need to own a
 * particular syntax-highlighting dependency.
 */
export type CodeHighlighter = (code: string, language: string, attrs: string) => string | undefined;

export interface MarkdownRenderOptions {
  highlight?: CodeHighlighter;
}

function createMarkdown(options: MarkdownRenderOptions, enableMath = true): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    breaks: false,
    // markdown-it preserves the fence's source newline by default. If a
    // caller supplies a highlighter, it may return escaped code or a complete
    // <pre> wrapper according to markdown-it's normal highlight contract.
    highlight: options.highlight
      ? (code, language, attrs) => {
          try {
            return options.highlight!(code, language, attrs) ?? '';
          } catch {
            // A broken optional highlighter must not make the document fail to
            // render. Returning an empty string selects markdown-it's escaped
            // default fence renderer.
            return '';
          }
        }
      : undefined,
  });

  md.validateLink = isSafeUrl;

  if (enableMath) {
    md.use(texmath, {
      engine: katex,
      delimiters: 'dollars',
      // KaTeX renders unsupported commands as visible text instead of
      // throwing. This keeps one bad formula from taking down the whole
      // Markdown preview.
      katexOptions: { throwOnError: false },
    });
  }

  return md;
}

function installImageResolver(md: MarkdownIt, resolveImage?: ImageResolver): void {
  if (!resolveImage) return;

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

export function renderMarkdown(
  mdText: string,
  resolveImage?: ImageResolver,
  options: MarkdownRenderOptions = {},
): string {
  const md = createMarkdown(options);
  installImageResolver(md, resolveImage);

  try {
    return md.render(mdText);
  } catch {
    // markdown-it-texmath already asks KaTeX not to throw for unsupported
    // commands. Keep this second guard for parser/engine failures outside
    // that normal path: render the original Markdown without math expansion,
    // so the source remains readable rather than losing the whole document.
    // Do not install the math plugin on the fallback parser. It intentionally
    // leaves the original TeX delimiters as ordinary Markdown text.
    const fallback = createMarkdown({ highlight: options.highlight }, false);
    installImageResolver(fallback, resolveImage);
    return fallback.render(mdText);
  }
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
