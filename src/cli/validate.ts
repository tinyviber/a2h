import { resolve } from 'node:path';
import { scanWorkspace } from '../scanner/scan';
import { loadWorkspaceSemantics } from '../semantics/load';
import { checkPathClaims } from './pathClaims';

// ---------------------------------------------------------------------------
// `a2h validate [path]` — the producer's pre-flight check.
//
// It answers one question: does this workspace match the protocol well enough
// that showing it to a human will not mislead anyone?
//
// The line between the two severities:
//
//   error   — the workspace *claims* something and the claim is broken, or a
//             broken file is one A2H refused to read. Presenting it would put
//             a false statement in front of a human. Exit 1.
//   warning — the workspace is renderable but thinner than it could be: an
//             inferred-only workspace, a role A2H has never seen, an action
//             no task points at. Exit 0.
//
// Nothing here re-parses the protocol. It runs the same `loadSemantics` the
// viewer runs and reads the structured refusals that loader records, so the
// validator cannot drift from what rendering actually does.
// ---------------------------------------------------------------------------

/** The roles A2H has built-in styling for. Any other role is still rendered. */
const BUILT_IN_ROLES = new Set([
  'readme',
  'markdown',
  'report',
  'code',
  'json',
  'log',
  'diff',
  'image',
  'file',
]);

export interface ValidateReport {
  rootDir: string;
  /** Where a manifest was read from, when one was usable. */
  manifestPath?: string;
  /**
   * True when a manifest file exists but could not be used. Distinguished from
   * `manifestPath === undefined` so the summary never says "zero-config" about
   * a workspace whose manifest was simply broken.
   */
  manifestUnusable?: boolean;
  counts: { items: number; tasks: number; actions: number; decisions: number };
  errors: string[];
  warnings: string[];
}

export function validateWorkspace(path: string): ValidateReport {
  const rootDir = resolve(path);
  const scan = scanWorkspace({ rootDir });
  const loaded = loadWorkspaceSemantics(rootDir, scan);

  const errors: string[] = [];
  const warnings: string[] = [];

  // A manifest that existed but could not be used is the loudest failure: the
  // workspace claims a protocol and A2H is silently ignoring it.
  if (loaded.manifestIssue) errors.push(loaded.manifestIssue);

  // --- paths the workspace claims a human can read -------------------------
  // Items, task and run artifacts, and markdown block targets all make the
  // same promise, so they are checked by the same code against the same
  // reader the viewer uses. `action.target` and `relation.target` are labels,
  // not file references, and are deliberately not checked.
  errors.push(...checkPathClaims(rootDir, scan, loaded));

  // --- the task / action wiring -------------------------------------------
  const taskIds = new Set(loaded.taskSpecs.map((t) => t.id));
  const actionIds = new Set(loaded.actionSpecs.map((a) => a.id));

  for (const task of loaded.taskSpecs) {
    for (const id of task.actions ?? []) {
      if (!actionIds.has(id)) {
        errors.push(`task "${task.id}" references unknown action "${id}"`);
      }
    }
  }
  for (const action of loaded.actionSpecs) {
    if (action.taskId !== undefined && !taskIds.has(action.taskId)) {
      errors.push(`action "${action.id}" belongs to a task "${action.taskId}" that is not declared`);
    }
  }

  // --- decision files A2H refused to read ---------------------------------
  errors.push(...loaded.decisionIssues);

  // --- warnings -----------------------------------------------------------
  if (!loaded.manifest && !loaded.manifestIssue) {
    warnings.push('no .a2h/manifest.json — this workspace is inferred from conventions (zero-config)');
  }

  // Producer-defined roles are the point of the protocol, so this is one
  // aggregated, explicitly-cosmetic line rather than one per artifact —
  // otherwise a workspace that uses roles well buries its real warnings.
  const customRoles: string[] = [];
  for (const item of loaded.itemSpecs) {
    if (item.role && !BUILT_IN_ROLES.has(item.role) && !customRoles.includes(item.role)) {
      customRoles.push(item.role);
    }
  }
  if (customRoles.length > 0) {
    warnings.push(
      `unknown role(s) ${customRoles.map((r) => `"${r}"`).join(', ')} — ` +
        'producer-defined roles render by content kind, so nothing needs to change',
    );
  }

  const referenced = new Set<string>();
  for (const task of loaded.taskSpecs) for (const id of task.actions ?? []) referenced.add(id);
  for (const action of loaded.actionSpecs) {
    const used = referenced.has(action.id) || (action.taskId !== undefined && taskIds.has(action.taskId));
    if (!used) {
      warnings.push(`action "${action.id}" is declared but no task points at it — a human may never see it`);
    }
  }

  if (loaded.manifest && loaded.taskSpecs.length === 0) {
    warnings.push('the manifest declares no tasks — there is nothing for a human to judge or act on');
  }

  // Scanner and loader warnings are reported, minus the ones already promoted
  // to structured errors above, so nothing is said twice.
  const promoted = new Set<string>([...loaded.decisionIssues]);
  if (loaded.manifestIssue) promoted.add(loaded.manifestIssue);
  for (const w of [...scan.warnings, ...loaded.warnings]) {
    if (!promoted.has(w)) warnings.push(w);
  }

  return {
    rootDir,
    manifestPath: loaded.manifestPath,
    manifestUnusable: loaded.manifestIssue !== undefined,
    counts: {
      items: loaded.itemSpecs.length,
      tasks: loaded.taskSpecs.length,
      actions: loaded.actionSpecs.length,
      decisions: loaded.decisions.length,
    },
    errors,
    warnings,
  };
}

/** Prints the human summary and returns the process exit code. */
export function printValidateReport(report: ValidateReport): number {
  console.log('');
  console.log(`  A2H validate — ${report.rootDir}`);
  console.log('');
  console.log(
    report.manifestPath
      ? `  manifest: ${report.manifestPath}`
      : report.manifestUnusable
        ? '  manifest: present but unusable — see the errors below'
        : '  manifest: none (zero-config — A2H infers everything)',
  );
  const { items, tasks, actions, decisions } = report.counts;
  console.log(`  ${items} item(s) · ${tasks} task(s) · ${actions} action(s) · ${decisions} decision(s)`);
  console.log('');

  for (const message of report.errors) console.log(`  error:   ${message}`);
  for (const message of report.warnings) console.log(`  warning: ${message}`);

  if (report.errors.length === 0 && report.warnings.length === 0) {
    console.log('  OK — nothing to fix.');
  } else {
    console.log('');
    console.log(`  ${report.errors.length} error(s), ${report.warnings.length} warning(s)`);
  }
  console.log('');

  return report.errors.length > 0 ? 1 : 0;
}
