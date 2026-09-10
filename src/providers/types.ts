import type { ActionView, EffectPolicy, RunView } from '../types';

// ---------------------------------------------------------------------------
// Provider / adapter boundary.
//
// A2H must never hard-depend on Codex, WorkBuddy, Hermes, or any specific
// model. Everything external enters through one of these seams:
//
//   ActionExecutor   — turns a human-facing action into an effect
//
// A future `ModelProvider`, `AgentProvider`, or `ArtifactProducer` would be
// registered the same way; only the executor seam is implemented today because
// it is the one the UI actually drives.
//
// An executor answers three questions, and the answers are what A2H reports:
//
//   handles(action)  — will this executor run it?
//   policy(action)   — what will that do, and must a human confirm it?
//   execute(...)     — do it, and say whether the effect was real
//
// `policy` is the seam that makes the security model sound. The workspace's
// `sideEffect` is a hint written by untrusted input; the executor is the code
// about to run, so its answer is the floor that a workspace cannot lower.
// ---------------------------------------------------------------------------

export interface ActionContext {
  /** Workspace root, so an executor can write real artifacts if it wants to. */
  workspaceRoot: string;
  /** Id assigned to the run this execution will produce. */
  runId: string;
  now: Date;
}

export interface ExecutionOutcome {
  /** Human-readable result line shown back in the UI. */
  message: string;
  /** New status for the owning task, when the action changes it. */
  taskStatus?: string;
  /** Run record to append, when the executor produced one. */
  run?: Omit<RunView, 'id' | 'taskId'> & { id?: string };
  /** Whether the effect really happened. A simulation must say `true`. */
  simulated: boolean;
}

export interface ActionExecutor {
  /** Stable id, e.g. "mock" or "workbuddy". */
  id: string;
  /** Description shown in diagnostics, not in the main UI. */
  description: string;
  handles(action: ActionView): boolean;
  /**
   * What this executor will actually do with the action, and whether the human
   * has to confirm first. Required, not optional: writing a provider means
   * stating its effect, and A2H will not run one that has not said.
   */
  policy(action: ActionView): EffectPolicy;
  execute(
    action: ActionView,
    params: Record<string, string> | undefined,
    ctx: ActionContext,
  ): Promise<ExecutionOutcome> | ExecutionOutcome;
}

/** The answer to "what happens if I click this?" — computed, not guessed. */
export interface ActionResolution {
  executor: ActionExecutor;
  /** True when this executor only simulates the effect. */
  simulated: boolean;
  /** The executor's authoritative policy for this action. */
  policy: EffectPolicy;
}

export interface ProviderRegistry {
  executors: ActionExecutor[];
  /**
   * Resolves the single executor that owns an action, with its provenance and
   * its policy. This is the only supported way to ask "who runs this?" —
   * asking the registry as a whole cannot answer it per action.
   */
  resolve(action: ActionView): ActionResolution | undefined;
  /** Convenience for callers that only need the executor. */
  findExecutor(action: ActionView): ActionExecutor | undefined;
  /**
   * True when *every* registered executor is a simulation, i.e. nothing real
   * is connected. Never use this to label an individual action: a workspace
   * can mix a real provider with the built-in simulator, and then this is
   * false while some actions are still simulated. Use `resolve()`.
   */
  readonly allSimulated: boolean;
}

export function createRegistry(executors: ActionExecutor[]): ProviderRegistry {
  return {
    executors,
    resolve(action) {
      const executor = executors.find((e) => e.handles(action));
      if (!executor) return undefined;
      return {
        executor,
        simulated: isSimulated(executor),
        policy: executor.policy(action),
      };
    },
    findExecutor(action) {
      return executors.find((e) => e.handles(action));
    },
    get allSimulated() {
      return executors.length > 0 && executors.every((e) => isSimulated(e));
    },
  };
}

const SIMULATED = new WeakSet<ActionExecutor>();

/** Marks an executor as a simulation so the UI can say so plainly. */
export function markSimulated<T extends ActionExecutor>(executor: T): T {
  SIMULATED.add(executor);
  return executor;
}

/**
 * Registered as a simulation either by name or by declaration. The id check
 * catches an executor constructed elsewhere; being wrong in this direction
 * under-promises a real effect, which is the side to err on.
 */
function isSimulated(executor: ActionExecutor): boolean {
  return SIMULATED.has(executor) || executor.id === 'mock';
}
