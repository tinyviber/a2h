import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readFileNoFollow, readHeadNoFollow, statNoFollow } from '../util/safeRead';
import { resolveRealPath } from '../security/boundary';
import type { Block, DecisionRecord, Metric, Relation, ScanResult } from '../types';
import type {
  ActionSpec,
  FrontmatterSemantics,
  GroupSpec,
  ItemSpec,
  LoadedSemantics,
  Manifest,
  RunSpec,
  TaskSpec,
} from './types';

// Reads the producer-authored semantics from disk. Everything here is
// best-effort: a malformed manifest produces a warning, never a crash, so a
// broken producer can never make `a2h render` unusable.
//
// "Best-effort" is not "trusting". The manifest and its run records are the
// most attractive files in a workspace for an attacker — they are the ones a
// producer is invited to write, and their contents steer the UI. So they are
// read with the same primitives as everything else:
//
//   * `statNoFollow` — never follows a link, so a manifest that is a symlink
//     to `/etc/passwd` is a link, not a document;
//   * `resolveRealPath` — the protocol directory must resolve inside the
//     workspace, so `.a2h -> /somewhere/else` is refused;
//   * `readFileNoFollow` + a byte cap — bounded, and never a symlink.
//
// The paths here are fixed by the protocol rather than chosen by a producer,
// which is why this does not go through `createWorkspaceReader`: the scanner
// deliberately ignores `.a2h`, so it is not in that allowlist and should not
// be. The read primitives are shared; only the allowlist differs.

export const MANIFEST_DIR = '.a2h';
const MANIFEST_CANDIDATES = [`${MANIFEST_DIR}/manifest.json`, 'a2h.json'];

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_RUN_FILE_BYTES = 512 * 1024;
const MAX_RUN_FILES = 200;
const MAX_DECISION_FILE_BYTES = 64 * 1024;
const MAX_DECISION_FILES = 200;
const MAX_FRONTMATTER_FILES = 500;
const FRONTMATTER_HEAD_BYTES = 8 * 1024;
const MAX_LIST = 500;

export interface LoadOptions {
  /** Workspace-relative paths of markdown files worth inspecting. */
  markdownPaths?: string[];
}

export function loadSemantics(rootDir: string, options: LoadOptions = {}): LoadedSemantics {
  const warnings: string[] = [];
  const out: LoadedSemantics = {
    taskSpecs: [],
    runSpecs: [],
    actionSpecs: [],
    itemSpecs: [],
    groupSpecs: [],
    frontmatter: new Map(),
    decisions: [],
    decisionIssues: [],
    warnings,
  };

  const manifest = readManifest(rootDir, warnings);
  if (manifest.issue) out.manifestIssue = manifest.issue;
  if (manifest.doc) {
    out.manifest = manifest.doc;
    out.manifestPath = manifest.path;
    const doc = manifest.doc;
    out.name = asString(doc.name);
    out.summary = asString(doc.summary);
    out.taskSpecs = readArray(doc.tasks, 'tasks', warnings).map((t) =>
      sanitizeTask(t, warnings),
    ).filter(isPresent);
    out.actionSpecs = readArray(doc.actions, 'actions', warnings).map((a) =>
      sanitizeAction(a, warnings),
    ).filter(isPresent);
    out.itemSpecs = readArray(doc.items, 'items', warnings).map((i) =>
      sanitizeItem(i, warnings),
    ).filter(isPresent);
    out.groupSpecs = readArray(doc.groups, 'groups', warnings).map((g) =>
      sanitizeGroup(g, warnings),
    ).filter(isPresent);
    out.runSpecs = readArray(doc.runs, 'runs', warnings).map((r) =>
      sanitizeRun(r, warnings),
    ).filter(isPresent);
    out.panels = sanitizeBlocks(doc.panels, warnings, 'panels');
  }

  // Run records may also live as one file per run, so a producer can append
  // without rewriting the manifest.
  const fileRuns = readRunFiles(rootDir, warnings);
  out.runSpecs.push(...fileRuns);

  // The action trail written by earlier sessions. A missing directory is the
  // normal case and means "nothing has been decided here yet".
  const decisions = readDecisionFiles(rootDir, warnings);
  out.decisions = decisions.records;
  out.decisionIssues = decisions.issues;

  // Producer metadata embedded in markdown frontmatter (lower precedence).
  for (const rel of options.markdownPaths ?? []) {
    const fm = readFrontmatterSemantics(join(rootDir, rel));
    if (fm) out.frontmatter.set(rel, fm);
  }

  return out;
}

export function hasExplicitSemantics(loaded: LoadedSemantics): boolean {
  return Boolean(loaded.manifest) || loaded.runSpecs.length > 0 || loaded.frontmatter.size > 0;
}

/**
 * Loads the protocol semantics for an already-scanned workspace.
 *
 * The markdown allowlist — which files are worth inspecting for `a2h_*`
 * frontmatter — is derived from the scan here rather than passed in by each
 * caller, so the viewer, `a2h validate`, and `a2h guide` cannot drift on which
 * files count as producer metadata. The rule has not changed: markdown, not a
 * symlink, not sensitive.
 */
export function loadWorkspaceSemantics(rootDir: string, scan: ScanResult): LoadedSemantics {
  return loadSemantics(rootDir, {
    markdownPaths: scan.files
      .filter((f) => f.kind === 'markdown' && !f.isSymlink && !f.sensitive)
      .map((f) => f.path),
  });
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

interface ManifestRead {
  doc?: Manifest;
  path?: string;
  /**
   * The first reason a present candidate was rejected. Kept even when a later
   * candidate parses, so a broken `manifest.json` shadowed by a valid
   * `a2h.json` is still reported rather than silently forgiven.
   */
  issue?: string;
}

function readManifest(rootDir: string, warnings: string[]): ManifestRead {
  let issue: string | undefined;
  const note = (message: string): void => {
    warnings.push(message);
    issue ??= message;
  };

  for (const rel of MANIFEST_CANDIDATES) {
    const abs = join(rootDir, rel);
    const stat = statNoFollow(abs);
    if (!stat) continue; // absent — try the next candidate
    if (stat.isSymbolicLink) {
      note(`${rel} is a symlink and was not read`);
      continue;
    }
    if (!stat.isFile) continue;
    if (stat.size > MAX_MANIFEST_BYTES) {
      note(`${rel} is too large to read (${stat.size} bytes)`);
      continue;
    }
    if (resolveRealPath(rootDir, rel) === null) {
      note(`${rel} does not resolve inside the workspace`);
      continue;
    }

    const read = readFileNoFollow(abs, MAX_MANIFEST_BYTES);
    if (!read) {
      note(`could not read ${rel}`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripBom(read.text));
    } catch (err) {
      note(`could not parse ${rel}: ${(err as Error).message}`);
      continue;
    }
    if (!isRecord(parsed)) {
      note(`${rel} must contain a JSON object`);
      continue;
    }
    if (parsed.a2h !== undefined && parsed.a2h !== 1) {
      // A version mismatch is not breakage — the protocol is additive — so it
      // stays a warning and the document is read as version 1.
      warnings.push(`${rel} declares protocol version ${String(parsed.a2h)}; reading as version 1`);
    }
    return { doc: parsed as Manifest, path: rel, issue };
  }
  return { issue };
}

// ---------------------------------------------------------------------------
// Durable decision records
// ---------------------------------------------------------------------------

interface DecisionRead {
  records: DecisionRecord[];
  issues: string[];
}

/**
 * Reads `.a2h/decisions/*.json`, newest first.
 *
 * Same primitives as run records, and for the same reason: these files steer
 * what the UI says happened, and the workspace that writes them is untrusted.
 * A refusal is reported as an issue rather than a warning because a decision
 * trail that silently drops entries is worse than one that says it did.
 */
function readDecisionFiles(rootDir: string, warnings: string[]): DecisionRead {
  const relDir = `${MANIFEST_DIR}/decisions`;
  const dir = join(rootDir, MANIFEST_DIR, 'decisions');
  const issues: string[] = [];
  const records: DecisionRecord[] = [];

  const dirStat = statNoFollow(dir);
  if (!dirStat) return { records, issues }; // no decisions yet — normal
  if (dirStat.isSymbolicLink) {
    const msg = `${relDir} is a symlink and was not read`;
    warnings.push(msg);
    issues.push(msg);
    return { records, issues };
  }
  if (!dirStat.isDirectory) {
    const msg = `${relDir} is not a directory`;
    warnings.push(msg);
    issues.push(msg);
    return { records, issues };
  }

  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return { records, issues };
  }

  // Newest first: the name begins with a UTC stamp, so lexical order is
  // chronological and the interesting end is the high one.
  names.sort().reverse();
  if (names.length > MAX_DECISION_FILES) {
    warnings.push(`${relDir} has ${names.length} files; reading the newest ${MAX_DECISION_FILES}`);
    names = names.slice(0, MAX_DECISION_FILES);
  }

  for (const name of names) {
    const rel = `${relDir}/${name}`;
    const abs = join(dir, name);

    const stat = statNoFollow(abs);
    if (!stat || stat.isSymbolicLink || !stat.isFile) {
      fail(`${rel} is a symlink or not a file; skipped`);
      continue;
    }
    if (stat.size > MAX_DECISION_FILE_BYTES) {
      fail(`${rel} is too large to read (${stat.size} bytes)`);
      continue;
    }
    if (resolveRealPath(rootDir, rel) === null) {
      fail(`${rel} does not resolve inside the workspace`);
      continue;
    }

    const read = readFileNoFollow(abs, MAX_DECISION_FILE_BYTES);
    if (!read) {
      fail(`could not read ${rel}`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripBom(read.text));
    } catch (err) {
      fail(`could not parse ${rel}: ${(err as Error).message}`);
      continue;
    }
    const record = sanitizeDecision(parsed);
    if (!record) {
      fail(`${rel} is not a decision record (needs "at" and "actionId")`);
      continue;
    }
    records.push(record);
  }

  return { records, issues };

  function fail(message: string): void {
    warnings.push(message);
    issues.push(message);
  }
}

function sanitizeDecision(input: unknown): DecisionRecord | undefined {
  if (!isRecord(input)) return undefined;
  const at = asString(input.at);
  const actionId = asString(input.actionId);
  if (!at || !actionId) return undefined;

  return {
    a2h: asNumber(input.a2h) ?? 1,
    at,
    actionId,
    kind: asString(input.kind) ?? 'n/a',
    sideEffect: asString(input.sideEffect) ?? 'none',
    // Both defaults point at the safe reading: an unlabelled record never
    // claims a success, and never claims a real (non-simulated) effect.
    ok: asBool(input.ok) ?? false,
    simulated: asBool(input.simulated) ?? true,
    message: asString(input.message) ?? '',
    executor: asString(input.executor) ?? 'unknown',
    params: sanitizeStringRecord(input.params),
    taskId: asString(input.taskId),
  };
}

/** Mirrors the engine's param bounds so a hand-written file cannot bloat the view. */
function sanitizeStringRecord(input: unknown): Record<string, string> | undefined {
  if (!isRecord(input)) return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [key, value] of Object.entries(input)) {
    if (n >= 20) break;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    out[key] = String(value).slice(0, 2000);
    n += 1;
  }
  return n > 0 ? out : undefined;
}

function readRunFiles(rootDir: string, warnings: string[]): RunSpec[] {
  const relDir = `${MANIFEST_DIR}/runs`;
  const dir = join(rootDir, MANIFEST_DIR, 'runs');

  const dirStat = statNoFollow(dir);
  if (!dirStat) return [];
  if (dirStat.isSymbolicLink) {
    warnings.push(`${relDir} is a symlink and was not read`);
    return [];
  }
  if (!dirStat.isDirectory) return [];

  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }

  // Newest first. Run files are named so that lexical order is chronological
  // (`2026-09-10-ingest.json`), which means the interesting end of the list is
  // the *high* end. Sorting ascending and slicing would pin the window to the
  // oldest runs forever, and a long-lived producer would never see its latest
  // work rendered.
  names.sort().reverse();
  if (names.length > MAX_RUN_FILES) {
    warnings.push(`${relDir} has ${names.length} files; reading the newest ${MAX_RUN_FILES}`);
    names = names.slice(0, MAX_RUN_FILES);
  }

  const runs: RunSpec[] = [];
  for (const name of names) {
    const abs = join(dir, name);
    const stat = statNoFollow(abs);
    if (!stat || stat.isSymbolicLink || !stat.isFile) {
      warnings.push(`${relDir}/${name} is a symlink or not a file; skipped`);
      continue;
    }
    if (stat.size > MAX_RUN_FILE_BYTES) {
      warnings.push(`${relDir}/${name} is too large to read (${stat.size} bytes)`);
      continue;
    }
    if (resolveRealPath(rootDir, `${relDir}/${name}`) === null) {
      warnings.push(`${relDir}/${name} does not resolve inside the workspace`);
      continue;
    }

    const read = readFileNoFollow(abs, MAX_RUN_FILE_BYTES);
    if (!read) {
      warnings.push(`could not read ${relDir}/${name}`);
      continue;
    }

    try {
      const parsed: unknown = JSON.parse(stripBom(read.text));
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const r = sanitizeRun(item, warnings);
          if (r) runs.push(r);
        }
      } else if (isRecord(parsed) && Array.isArray(parsed.runs)) {
        for (const item of parsed.runs) {
          const r = sanitizeRun(item, warnings);
          if (r) runs.push(r);
        }
      } else {
        const r = sanitizeRun(parsed, warnings);
        if (r) runs.push(r);
      }
    } catch (err) {
      warnings.push(`could not parse ${relDir}/${name}: ${(err as Error).message}`);
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Frontmatter producer metadata
// ---------------------------------------------------------------------------

/** Recognised frontmatter keys, all prefixed to avoid clashing with prose. */
export function readFrontmatterSemantics(absPath: string): FrontmatterSemantics | undefined {
  const head = readHead(absPath, FRONTMATTER_HEAD_BYTES);
  if (!head.startsWith('---')) return undefined;
  const lines = head.split(/\r?\n/);
  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (closeIdx === -1) return undefined;

  const out: FrontmatterSemantics = {};
  let any = false;
  for (let i = 1; i < closeIdx; i++) {
    const m = lines[i]!.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = unquote(m[2]!.trim());
    switch (key) {
      case 'a2h_role': out.role = value; any = true; break;
      case 'a2h_title': out.title = value; any = true; break;
      case 'a2h_summary': out.summary = value; any = true; break;
      case 'a2h_group': out.group = value; any = true; break;
      case 'a2h_task': out.taskId = value; any = true; break;
      case 'a2h_status': out.status = value; any = true; break;
      case 'a2h_priority': {
        const n = Number(value);
        if (Number.isFinite(n)) { out.priority = n; any = true; }
        break;
      }
      case 'a2h_tags': {
        const tags = value.split(',').map((t) => t.trim()).filter(Boolean);
        if (tags.length) { out.tags = tags; any = true; }
        break;
      }
      case 'a2h_hidden':
        out.hidden = value === 'true' || value === 'yes';
        any = true;
        break;
      default:
        break;
    }
  }
  return any ? out : undefined;
}

function readHead(absPath: string, maxBytes: number): string {
  return readHeadNoFollow(absPath, maxBytes) ?? '';
}

// ---------------------------------------------------------------------------
// Validation helpers — lenient by design
// ---------------------------------------------------------------------------

function sanitizeTask(input: unknown, warnings: string[]): TaskSpec | undefined {
  if (!isRecord(input)) return undefined;
  const id = asString(input.id);
  if (!id) {
    warnings.push('manifest: a task is missing "id" and was skipped');
    return undefined;
  }
  return {
    id,
    title: asString(input.title),
    status: asString(input.status),
    summary: asString(input.summary),
    group: asString(input.group),
    owner: asString(input.owner),
    updatedAt: asString(input.updatedAt),
    progress: sanitizeProgress(input.progress),
    metrics: sanitizeMetrics(input.metrics),
    blocks: sanitizeBlocks(input.blocks, warnings, `task "${id}"`),
    actions: asStringArray(input.actions),
    artifacts: asStringArray(input.artifacts),
  };
}

function sanitizeRun(input: unknown, warnings: string[]): RunSpec | undefined {
  if (!isRecord(input)) return undefined;
  const id = asString(input.id);
  if (!id) {
    warnings.push('manifest: a run is missing "id" and was skipped');
    return undefined;
  }
  const steps = readArray(input.steps, `run "${id}" steps`, warnings)
    .filter(isRecord)
    .slice(0, MAX_LIST)
    .map((s, i) => ({
      id: asString(s.id) ?? `step-${i + 1}`,
      title: asString(s.title) ?? `Step ${i + 1}`,
      status: asString(s.status),
      detail: asString(s.detail),
      at: asString(s.at),
    }));

  return {
    id,
    taskId: asString(input.taskId),
    title: asString(input.title),
    status: asString(input.status),
    startedAt: asString(input.startedAt),
    endedAt: asString(input.endedAt),
    durationMs: asNumber(input.durationMs),
    summary: asString(input.summary),
    artifacts: asStringArray(input.artifacts),
    steps: steps.length ? steps : undefined,
    blocks: sanitizeBlocks(input.blocks, warnings, `run "${id}"`),
  };
}

function sanitizeAction(input: unknown, warnings: string[]): ActionSpec | undefined {
  if (!isRecord(input)) return undefined;
  const id = asString(input.id);
  const label = asString(input.label);
  if (!id || !label) {
    warnings.push('manifest: an action needs both "id" and "label" and was skipped');
    return undefined;
  }
  const sideEffectRaw = asString(input.sideEffect);
  const sideEffect =
    sideEffectRaw === 'none' || sideEffectRaw === 'external' ? sideEffectRaw : 'state';

  const params = readArray(input.params, `action "${id}" params`, warnings)
    .filter(isRecord)
    .slice(0, 20)
    .map((p) => {
      const rawType = asString(p.type);
      const type: 'text' | 'textarea' | 'select' | 'boolean' =
        rawType === 'textarea' || rawType === 'select' || rawType === 'boolean' ? rawType : 'text';
      return {
        name: asString(p.name) ?? 'value',
        label: asString(p.label),
        type,
        required: asBool(p.required),
        options: asStringArray(p.options),
        placeholder: asString(p.placeholder),
        default: typeof p.default === 'string' || typeof p.default === 'boolean' ? p.default : undefined,
      };
    });

  return {
    id,
    label,
    kind: asString(input.kind) ?? 'custom',
    taskId: asString(input.taskId),
    target: asString(input.target),
    description: asString(input.description),
    sideEffect,
    // A manifest may raise protection, never lower it. `external` means the
    // effect leaves this machine, so confirmation is not the producer's to
    // waive — `confirm: false` on an external action is ignored rather than
    // honoured. (The engine enforces the same rule independently, because an
    // untrusted workspace should not be able to set the security policy even
    // if this loader is ever bypassed.)
    confirm: sideEffect === 'external' ? true : (asBool(input.confirm) ?? false),
    params: params.length ? params : undefined,
    enabled: asBool(input.enabled) ?? true,
  };
}

function sanitizeItem(input: unknown, warnings: string[]): ItemSpec | undefined {
  if (!isRecord(input)) return undefined;
  const path = asString(input.path);
  if (!path) {
    warnings.push('manifest: an item is missing "path" and was skipped');
    return undefined;
  }
  return {
    path: path.replace(/^\.\//, ''),
    role: asString(input.role),
    title: asString(input.title),
    summary: asString(input.summary),
    group: asString(input.group),
    taskId: asString(input.taskId),
    priority: asNumber(input.priority),
    tags: asStringArray(input.tags),
    hidden: asBool(input.hidden),
    relations: sanitizeRelations(input.relations),
    metrics: sanitizeMetrics(input.metrics),
    blocks: sanitizeBlocks(input.blocks, warnings, `item "${path}"`),
  };
}

function sanitizeGroup(input: unknown, warnings: string[]): GroupSpec | undefined {
  if (!isRecord(input)) return undefined;
  const id = asString(input.id);
  if (!id) {
    warnings.push('manifest: a group is missing "id" and was skipped');
    return undefined;
  }
  return {
    id,
    title: asString(input.title),
    description: asString(input.description),
    order: asNumber(input.order),
    taskId: asString(input.taskId),
  };
}

function sanitizeProgress(input: unknown): { done: number; total: number; label?: string } | undefined {
  if (!isRecord(input)) return undefined;
  const done = asNumber(input.done);
  const total = asNumber(input.total);
  if (done === undefined || total === undefined) return undefined;
  return { done, total, label: asString(input.label) };
}

function sanitizeMetrics(input: unknown): Metric[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const items = input.filter(isRecord).slice(0, 24).map((m) => {
    const value = m.value;
    return {
      label: asString(m.label) ?? 'metric',
      value: typeof value === 'number' ? value : asString(value) ?? '',
      unit: asString(m.unit),
      delta: asString(m.delta),
      tone: sanitizeTone(m.tone),
    } satisfies Metric;
  });
  return items.length ? items : undefined;
}

function sanitizeRelations(input: unknown): Relation[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: Relation[] = [];
  for (const r of input.slice(0, 50)) {
    if (typeof r === 'string') {
      out.push({ kind: 'related', target: r });
      continue;
    }
    if (!isRecord(r)) continue;
    const target = asString(r.target) ?? asString(r.path);
    if (!target) continue;
    out.push({ kind: asString(r.kind) ?? 'related', target, note: asString(r.note) });
  }
  return out.length ? out : undefined;
}

const TONES = new Set(['neutral', 'good', 'warn', 'bad', 'info']);
function sanitizeTone(input: unknown): Metric['tone'] {
  const s = asString(input);
  return s && TONES.has(s) ? (s as Metric['tone']) : undefined;
}

/**
 * Blocks are passed through as opaque data — the client renderer registry
 * decides what it can draw and shows a fallback otherwise. We only guarantee
 * the shape is an object with a string `type`, which keeps the protocol
 * forward-compatible without a version bump per block kind.
 */
function sanitizeBlocks(input: unknown, warnings: string[], where: string): Block[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out: Block[] = [];
  for (const b of input.slice(0, MAX_LIST)) {
    if (!isRecord(b) || typeof b.type !== 'string' || !b.type) {
      warnings.push(`${where}: a block was skipped (missing a string "type")`);
      continue;
    }
    out.push(b as Block);
  }
  return out.length ? out : undefined;
}

// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPresent<T>(v: T | undefined): v is T {
  return v !== undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function asBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, MAX_LIST);
  return out.length ? out : undefined;
}

function readArray(v: unknown, where: string, warnings: string[]): unknown[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    warnings.push(`manifest: "${where}" must be an array`);
    return [];
  }
  return v;
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}
