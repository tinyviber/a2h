/**
 * One answer to "may this href be rendered as a link?", for every layer that
 * writes one.
 *
 * Producer-authored JSON reaches the page as a link target in more than one
 * place (list items today, and whatever block kind is added next), and the
 * renderer is not the only consumer: a link that survives server-side
 * normalisation is also what any future consumer will see. So the policy is a
 * small shared allowlist rather than a check inside the one renderer we
 * happened to write today.
 *
 * Allowed:
 *   - `http:` / `https:` / `mailto:`   — the same three the markdown renderer
 *     validates links against, so a workspace has one URL policy, not two
 *   - `#...`                           — an in-page anchor
 *   - a workspace-relative path        — routed as an artifact
 *
 * Everything else is refused. `javascript:` and `vbscript:` are script
 * execution; `data:` and `blob:` are document injection; `file:` reaches the
 * local disk. That the page's CSP would also stop some of them is not a reason
 * to pass them through — a second line of defence is not a first one.
 *
 * Protocol-relative (`//host/path`) is refused as well: it is an off-site
 * navigation wearing a path's clothes.
 */
const SAFE_LINK_SCHEMES = /^(?:https?|mailto):/i;
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function hasScheme(value: string): boolean {
  return HAS_SCHEME.test(value);
}

export function isSafeLinkHref(href: unknown): href is string {
  if (typeof href !== 'string') return false;
  const value = href.trim();
  if (value === '') return false;
  if (value.startsWith('#')) return true;
  if (value.startsWith('//')) return false;
  if (hasScheme(value)) return SAFE_LINK_SCHEMES.test(value);
  return true;
}

/** True when the value is a workspace-relative path (no scheme, no `//`). */
export function isWorkspaceRelative(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.startsWith('//')) return false;
  return !hasScheme(trimmed);
}
