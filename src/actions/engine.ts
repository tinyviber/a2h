import type {
  ActionAuditEntry,
  ActionParam,
  ActionResult,
  ActionRequest,
  ActionView,
  RunView,
} from '../types';
import type { ProviderRegistry } from '../providers/types';
import { policyFromHint, strictestPolicy } from './policy';
import { writeDecisionRecord } from './decisions';

// ---------------------------------------------------------------------------
// Action engine — the security boundary between the browser and anything with
// an effect.
//
// Guarantees, in order of importance:
//
//   1. Only actions *declared in the workspace manifest* can be executed. The
//      browser sends an id; it can never send a command.
//   2. Values from the browser are filtered against the declared schema before
//      an executor ever sees them: undeclared keys are dropped, and a value
//      that is not legal for its declared type is refused. Nothing is
//      interpolated into a shell or used as a path.
//   3. An effect that reaches beyond A2H's own state requires an explicit
//      second confirmation from the human. This is decided here, from two
//      claims — the workspace's and the executor's — merged with the stricter
//      winning. Neither is trusted on its own: the manifest is untrusted
//      input, and it is the executor's declared policy that a workspace cannot
//      talk down.
//   4. Execution is delegated to a registered executor. The built-in executor
//      only simulates state changes, so nothing dangerous can happen by
//      default — but the protocol and the UI flow are fully exercised.
//
// The engine keeps an in-memory audit trail and in-memory run/status state.
// One thing it does write: a durable decision record under `.a2h/decisions/`
// for every attempt, so a restart does not erase the fact that a human acted.
// That record is an output only — nothing reads it back as authority.
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

    const declaredParams = action.params ?? [];
    const outcome = buildParams(request.params, declaredParams);
    if (outcome.invalid) {
      return this.fail(
        action.id,
        'invalid_params',
        `"${outcome.invalid.name}" ${outcome.invalid.reason}.`,
      );
    }
    const params = outcome.params;

    const missing = declaredParams
      .filter((p) => p.required && !String(params[p.name] ?? '').trim())
      .map((p) => p.label ?? p.name);
    if (missing.length > 0) {
      return this.fail(action.id, 'missing_params', `Missing required input: ${missing.join(', ')}.`);
    }

    // Who runs this, and what they say it will do. Asked before the
    // confirmation check, because the answer is half of that decision.
    const resolution = this.registry.resolve(action);
    if (!resolution) {
      return this.fail(
        action.id,
        'no_executor',
        `No provider can execute "${action.kind}" actions in this workspace.`,
      );
    }

    // The hard boundary, recomputed from both claims rather than read off the
    // incoming view: the workspace may escalate the level, the executor may
    // escalate it, and the merge takes the higher one. A forged ActionView
    // therefore cannot de-escalate anything either.
    const policy = strictestPolicy(
      policyFromHint(action.sideEffect, action.confirm),
      resolution.policy,
    );
    if (policy.confirmation === 'required' && request.confirm !== true) {
      return this.fail(
        action.id,
        'confirmation_required',
        `"${action.label}" has a ${policy.effect} side effect and needs confirmation.`,
        resolution.executor.id,
        policy.effect,
      );
    }

    this.seq += 1;
    const runId = `run-${this.seq}-${slug(action.kind)}`;

    try {
      const outcome = await resolution.executor.execute(action, params, {
        workspaceRoot: this.rootDir,
        runId,
        now: this.now(),
      });

      // Provenance is the registry's answer OR the executor's, never the
      // executor's alone: a simulator that forgets to label its output, or a
      // provider that claims a real effect it did not have, both end up
      // reported as simulated rather than the reverse.
      const simulated = resolution.simulated || outcome.simulated === true;

      const run: RunView | undefined = outcome.run
        ? {
            ...outcome.run,
            id: outcome.run.id ?? runId,
            taskId: action.taskId,
            simulated,
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

      this.record(
        {
          at: this.now().toISOString(),
          actionId: action.id,
          kind: action.kind,
          sideEffect: policy.effect,
          ok: true,
          simulated,
          message: outcome.message,
          executor: resolution.executor.id,
        },
        // Only what actually reached the executor is persisted, and those are
        // the params already filtered against the declared schema above.
        { params, taskId: action.taskId },
      );

      return {
        ok: true,
        actionId: action.id,
        message: outcome.message,
        simulated,
        run,
        task:
          action.taskId && outcome.taskStatus
            ? { id: action.taskId, status: outcome.taskStatus }
            : undefined,
      };
    } catch (err) {
      const message = `Executor "${resolution.executor.id}" failed: ${(err as Error).message}`;
      return this.fail(action.id, 'executor_failed', message, resolution.executor.id, policy.effect);
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
    sideEffect = 'none',
  ): ActionResult {
    this.record({
      at: this.now().toISOString(),
      actionId,
      kind: 'n/a',
      sideEffect,
      ok: false,
      simulated: false,
      message,
      executor,
    });
    return { ok: false, actionId, message, simulated: false, error };
  }

  private record(entry: AuditEntry, meta?: DecisionMeta): void {
    this.audit.unshift(entry);
    if (this.audit.length > MAX_AUDIT) this.audit.length = MAX_AUDIT;

    // The durable half of the trail. This is the one place both the success
    // path and every refusal funnel through, which is what makes "exactly one
    // record per attempt" true by construction rather than by convention.
    //
    // Best-effort on purpose: a read-only checkout, or a `.a2h` that is a
    // symlink, means the record is refused — and an action that genuinely ran
    // must not be reported as failed because its note could not be filed.
    try {
      writeDecisionRecord(this.rootDir, {
        a2h: 1,
        ...entry,
        params: meta?.params,
        taskId: meta?.taskId,
      });
    } catch {
      /* audit persistence never fails an action */
    }
  }
}

interface DecisionMeta {
  params?: Record<string, string>;
  taskId?: string;
}

interface ParamOutcome {
  params: Record<string, string>;
  /** Set when a value was supplied but is not legal for its declared type. */
  invalid?: { name: string; reason: string };
}

/**
 * Untrusted browser input, filtered against the action's declared schema.
 *
 * The distinguishing property is what is *absent* from the result: a key the
 * action never declared. An executor written against the spec therefore cannot
 * be reached by `shell`, `cwd`, or anything else a hostile page invents — not
 * because the executor remembers to ignore them, but because they never arrive.
 *
 * Values that are legal for their type are normalized (`boolean` becomes the
 * string "true"/"false"), so an executor has one shape to handle.
 */
function buildParams(input: unknown, declared: ActionParam[]): ParamOutcome {
  const params: Record<string, string> = {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { params };

  const supplied = input as Record<string, unknown>;

  for (const spec of declared.slice(0, MAX_PARAMS)) {
    const raw = supplied[spec.name];
    if (raw === undefined) continue;
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue;

    const value = String(raw).slice(0, MAX_PARAM_LENGTH);

    if (spec.type === 'select') {
      const options = spec.options ?? [];
      // An out-of-range select is refused rather than passed through: a
      // provider that branches on this value would otherwise be steerable.
      if (options.length > 0 && !options.includes(value)) {
        return { params, invalid: { name: spec.name, reason: `must be one of: ${options.join(', ')}` } };
      }
    }

    if (spec.type === 'boolean') {
      const normalized = value.trim().toLowerCase();
      if (normalized !== 'true' && normalized !== 'false') {
        return { params, invalid: { name: spec.name, reason: 'must be true or false' } };
      }
      params[spec.name] = normalized;
      continue;
    }

    params[spec.name] = value;
  }

  return { params };
}

function slug(kind: string): string {
  return kind.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'action';
}
