import type { ActionView, RunStep, RunView } from '../types';
import type { ActionContext, ActionExecutor, ExecutionOutcome } from './types';
import { markSimulated } from './types';

// ---------------------------------------------------------------------------
// The built-in mock executor.
//
// Design rules:
//   1. It NEVER executes a shell command, writes files, or contacts a network.
//   2. It only ever simulates a *state* change, then reports that it did so.
//   3. Its output is deterministic given (action, task), so tests and demos are
//      stable.
//
// This exists so the whole product flow — human clicks → request → state
// change → run record → UI update — is real, while the external effect is
// honestly labelled as simulated.
// ---------------------------------------------------------------------------

interface Simulation {
  taskStatus: string;
  runStatus: string;
  message: string;
  steps: { title: string; status: string; detail?: string }[];
}

const SIMULATIONS: Record<string, Simulation> = {
  approve: {
    taskStatus: 'succeeded',
    runStatus: 'succeeded',
    message: 'Approved. A downstream agent would now pick this up.',
    steps: [
      { title: 'Record decision', status: 'succeeded' },
      { title: 'Notify owner', status: 'succeeded', detail: 'no agent connected — simulated' },
      { title: 'Emit approved marker', status: 'succeeded' },
    ],
  },
  reject: {
    taskStatus: 'cancelled',
    runStatus: 'succeeded',
    message: 'Rejected. The task is closed without action.',
    steps: [
      { title: 'Record decision', status: 'succeeded' },
      { title: 'Close task', status: 'succeeded' },
    ],
  },
  retry: {
    taskStatus: 'running',
    runStatus: 'running',
    message: 'Retry queued. A connected agent would re-run the task now.',
    steps: [
      { title: 'Requeue task', status: 'succeeded' },
      { title: 'Dispatch to agent', status: 'pending', detail: 'no agent connected — simulated' },
    ],
  },
  continue: {
    taskStatus: 'running',
    runStatus: 'running',
    message: 'Continuing. Remaining work handed back to the agent.',
    steps: [
      { title: 'Acknowledge human input', status: 'succeeded' },
      { title: 'Resume remaining steps', status: 'running' },
    ],
  },
  run: {
    taskStatus: 'running',
    runStatus: 'running',
    message: 'Run started (simulated).',
    steps: [
      { title: 'Prepare inputs', status: 'succeeded' },
      { title: 'Execute', status: 'running', detail: 'simulated execution' },
    ],
  },
  publish: {
    taskStatus: 'succeeded',
    runStatus: 'succeeded',
    message: 'Publish simulated — nothing left this machine.',
    steps: [
      { title: 'Validate output', status: 'succeeded' },
      { title: 'Publish', status: 'succeeded', detail: 'simulated, no external call' },
    ],
  },
  open: {
    taskStatus: 'info',
    runStatus: 'succeeded',
    message: 'Opened. No state change.',
    steps: [{ title: 'Resolve target', status: 'succeeded' }],
  },
  discard: {
    taskStatus: 'cancelled',
    runStatus: 'succeeded',
    message: 'Discarded (simulated). The artifact was not modified.',
    steps: [{ title: 'Mark discarded', status: 'succeeded' }],
  },
  'apply-diff': {
    taskStatus: 'succeeded',
    runStatus: 'succeeded',
    message: 'Apply simulated. No file on disk was modified.',
    steps: [
      { title: 'Check patch applies', status: 'succeeded' },
      { title: 'Apply patch', status: 'succeeded', detail: 'simulated, files untouched' },
    ],
  },
  'send-to-agent': {
    taskStatus: 'running',
    runStatus: 'running',
    message: 'Handed to agent (simulated) — no provider connected.',
    steps: [
      { title: 'Package context', status: 'succeeded' },
      { title: 'Deliver to agent', status: 'pending', detail: 'no provider connected' },
    ],
  },
};

const FALLBACK: Simulation = {
  taskStatus: 'succeeded',
  runStatus: 'succeeded',
  message: 'Action recorded (simulated).',
  steps: [{ title: 'Record action', status: 'succeeded' }],
};

export function createMockExecutor(): ActionExecutor {
  const executor: ActionExecutor = {
    id: 'mock',
    description: 'Built-in simulator: changes A2H state only, never touches the system.',

    handles() {
      // The mock is the catch-all: it stands in for every action until a real
      // provider registers itself ahead of it.
      return true;
    },

    policy() {
      // The honest answer for this executor, not a guess about the action: the
      // mock changes A2H's own in-memory state and nothing else. No network,
      // no shell, no writes.
      //
      // Note what this is *not*: a defence against a workspace that understates
      // an action. A workspace can declare `sideEffect: "state"` for a publish
      // and the mock will agree, because the mock really does nothing — there
      // is no harm to prevent. The defence is that a *real* provider states its
      // own policy and the merge takes the stricter of the two, so the same
      // lie is caught the moment a provider that publishes is registered.
      return { effect: 'state', confirmation: 'optional' };
    },

    execute(
      action: ActionView,
      params: Record<string, string> | undefined,
      ctx: ActionContext,
    ): ExecutionOutcome {
      const sim = SIMULATIONS[action.kind] ?? FALLBACK;
      const now = ctx.now.toISOString();

      const steps: RunStep[] = sim.steps.map((s, i) => ({
        id: `${ctx.runId}-s${i + 1}`,
        title: s.title,
        status: s.status,
        detail: s.detail,
        at: now,
      }));

      const paramNote = formatParams(params);
      const run: Omit<RunView, 'id' | 'taskId'> & { id?: string } = {
        title: `${action.label}${action.target ? ` — ${action.target}` : ''}`,
        status: sim.runStatus,
        startedAt: now,
        endedAt: sim.runStatus === 'running' ? undefined : now,
        durationMs: sim.runStatus === 'running' ? undefined : 40,
        summary: paramNote ? `${sim.message} (${paramNote})` : sim.message,
        artifacts: [],
        steps,
        simulated: true,
        blocks: [
          {
            type: 'notice',
            tone: 'info',
            text:
              'This run was produced by the built-in mock executor. No agent, ' +
              'model, or shell command was involved.',
          },
        ],
      };

      return {
        message: sim.message,
        taskStatus: sim.taskStatus,
        run,
        simulated: true,
      };
    },
  };

  return markSimulated(executor);
}

function formatParams(params: Record<string, string> | undefined): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== '');
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}=${truncate(v)}`).join(', ');
}

function truncate(v: string): string {
  return v.length > 60 ? `${v.slice(0, 57)}…` : v;
}
