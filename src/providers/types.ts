import type { ActionView, RunView } from '../types';

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
  simulated: boolean;
}

export interface ActionExecutor {
  /** Stable id, e.g. "mock" or "workbuddy". */
  id: string;
  /** Description shown in diagnostics, not in the main UI. */
  description: string;
  handles(action: ActionView): boolean;
  execute(
    action: ActionView,
    params: Record<string, string> | undefined,
    ctx: ActionContext,
  ): Promise<ExecutionOutcome> | ExecutionOutcome;
}

export interface ProviderRegistry {
  executors: ActionExecutor[];
  findExecutor(action: ActionView): ActionExecutor | undefined;
  /** True when every registered executor is a simulation. */
  readonly simulated: boolean;
}

export function createRegistry(executors: ActionExecutor[]): ProviderRegistry {
  return {
    executors,
    findExecutor(action) {
      return executors.find((e) => e.handles(action));
    },
    get simulated() {
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

function isSimulated(executor: ActionExecutor): boolean {
  return SIMULATED.has(executor) || executor.id === 'mock';
}
