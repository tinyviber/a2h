import type { ActionAuditEntry, ActionResult, ActionRequest, ActionView, RunView } from '../types';
import type { ProviderRegistry } from '../providers/types';

// ---------------------------------------------------------------------------
// Action engine — the security boundary between the browser and anything with
// an effect.
//
// Guarantees, in order of importance:
//
//   1. Only actions *declared in the workspace manifest* can be executed. The
//      browser sends an id; it can never send a command.
//   2. Values from the browser are treated as untrusted strings: length-capped,
//      never interpolated into a shell, never used as a path.
//   3. Anything whose side effect reaches beyond A2H's own state requires an
//      explicit second confirmation from the human.
//   4. Execution is delegated to a registered executor. The built-in executor
//      only simulates state changes, so nothing dangerous can happen by
//      default — but the protocol and the UI flow are fully exercised.
//
// The engine keeps an in-memory audit trail and in-memory run/status state. It
// deliberately writes nothing to the workspace.
// ---------------------------------------------------------------------------

const MAX_PARAM_LENGTH = 2000;
const MAX_PARAMS = 20;
const MAX_RUNTIME_RUNS = 200;
const MAX_AUDIT = 200;

export type AuditEntry = ActionAuditEntry;

export interface ActionEngineOptions {
  rootDir: string;
  registry: ProviderRegistry;
  now?: () => Date;
}

export class ActionEngine {
  private readonly rootDir: string;
  private readonly registry: ProviderRegistry;
  private readonly now: () => Date;

  private runtimeRuns: RunView[] = [];
  private taskStatus = new Map<string, string>();
  private audit: AuditEntry[] = [];
  private seq = 0;

  constructor(options: ActionEngineOptions) {
    this.rootDir = options.rootDir;
    this.registry = options.registry;
    this.now = options.now ?? (() => new Date());
  }

  /** Runs produced by actions during this session, newest first. */
  getRuntimeRuns(): RunView[] {
    return this.runtimeRuns;
  }

  /** Task status overrides applied by executed actions. */
  getTaskStatus(taskId: string): string | undefined {
    return this.taskStatus.get(taskId);
  }

  getAuditTrail(): AuditEntry[] {
    return this.audit;
  }

  /**
   * Executes a declared action.
   *
   * @param declared the action registry as published to the client. Anything
   *   not present here is rejected — this is the allowlist.
   */
  async execute(request: ActionRequest, declared: ActionView[]): Promise<ActionResult> {
    const action = declared.find((a) => a.id === request.id);
    if (!action) {
      return this.fail(request.id, 'unknown_action', 'That action is not declared by this workspace.');
    }
    if (!action.enabled) {
      return this.fail(action.id, 'disabled', `"${action.label}" is currently disabled.`);
    }

    const params = sanitizeParams(request.params);
    const missing = (action.params ?? [])
      .filter((p) => p.required && !String(params[p.name] ?? '').trim())
      .map((p) => p.label);
    if (missing.length > 0) {
      return this.fail(action.id, 'missing_params', `Missing required input: ${missing.join(', ')}.`);
    }

    if (action.confirm && request.confirm !== true) {
      return this.fail(
        action.id,
        'confirmation_required',
        `"${action.label}" has a ${action.sideEffect} side effect and needs confirmation.`,
      );
    }

    const executor = this.registry.findExecutor(action);
    if (!executor) {
      return this.fail(
        action.id,
        'no_executor',
        `No provider can execute "${action.kind}" actions in this workspace.`,
      );
    }

    this.seq += 1;
    const runId = `run-${this.seq}-${slug(action.kind)}`;

    try {
      const outcome = await executor.execute(action, params, {
        workspaceRoot: this.rootDir,
        runId,
        now: this.now(),
      });

      const run: RunView | undefined = outcome.run
        ? {
            ...outcome.run,
            id: outcome.run.id ?? runId,
            taskId: action.taskId,
            simulated: outcome.simulated,
          }
        : undefined;

      if (run) {
        this.runtimeRuns.unshift(run);
        if (this.runtimeRuns.length > MAX_RUNTIME_RUNS) {
          this.runtimeRuns.length = MAX_RUNTIME_RUNS;
        }
      }
      if (action.taskId && outcome.taskStatus) {
        this.taskStatus.set(action.taskId, outcome.taskStatus);
      }

      this.record({
        at: this.now().toISOString(),
        actionId: action.id,
        kind: action.kind,
        sideEffect: action.sideEffect,
        ok: true,
        simulated: outcome.simulated,
        message: outcome.message,
        executor: executor.id,
      });

      return {
        ok: true,
        actionId: action.id,
        message: outcome.message,
        simulated: outcome.simulated,
        run,
        task:
          action.taskId && outcome.taskStatus
            ? { id: action.taskId, status: outcome.taskStatus }
            : undefined,
      };
    } catch (err) {
      const message = `Executor "${executor.id}" failed: ${(err as Error).message}`;
      return this.fail(action.id, 'executor_failed', message, executor.id);
    }
  }

  /**
   * Records a refused or failed attempt and returns the result.
   *
   * Exactly one audit line is written per attempt — including the ones that
   * never reached an executor. Attribution matters here: the trail is the
   * record of what was asked for and what actually happened.
   */
  private fail(
    actionId: string,
    error: string,
    message: string,
    executor = 'none',
  ): ActionResult {
    this.record({
      at: this.now().toISOString(),
      actionId,
      kind: 'n/a',
      sideEffect: 'none',
      ok: false,
      simulated: false,
      message,
      executor,
    });
    return { ok: false, actionId, message, simulated: false, error };
  }

  private record(entry: AuditEntry): void {
    this.audit.unshift(entry);
    if (this.audit.length > MAX_AUDIT) this.audit.length = MAX_AUDIT;
  }
}

/** Untrusted browser input: cap size, cap count, stringify, drop empties. */
function sanitizeParams(input: unknown): Record<string, string> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  let n = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (n >= MAX_PARAMS) break;
    if (typeof key !== 'string' || key.length > 64) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    out[key] = String(value).slice(0, MAX_PARAM_LENGTH);
    n += 1;
  }
  return out;
}

function slug(kind: string): string {
  return kind.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'action';
}
