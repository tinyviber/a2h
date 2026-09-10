import type { EffectPolicy, SideEffect } from '../types';

// ---------------------------------------------------------------------------
// Effect policy — the one place the confirmation boundary is computed.
//
// There are two statements about how dangerous an action is:
//
//   * the workspace's claim  — `sideEffect` + `confirm` in the manifest. The
//     workspace is untrusted input, so this is a *hint*.
//   * the provider's claim   — `ActionExecutor.policy()`. The provider is the
//     code that will actually run, so this is *authoritative*.
//
// They are merged, and the stricter one wins, every time. A workspace can say
// "this is worse than you think" and get a confirmation prompt; it can never
// say "this is fine" and remove one. The old model let it: a manifest that
// called a future `publish` action `sideEffect: "state"` decided its own
// safety level, which is the wrong direction for untrusted input to point.
//
// The merge also normalizes one invariant: an effect that leaves this machine
// always requires confirmation, whatever either side said. Spelling it here
// rather than at the call site means there is no path that forgets it.
// ---------------------------------------------------------------------------

const RANK: Record<SideEffect, number> = { none: 0, state: 1, external: 2 };

/**
 * The invariant, applied to every policy that leaves this module: an effect
 * that reaches outside this machine is always confirmed. Stated once here
 * rather than at each call site, because there is no path that should skip it.
 */
function normalize(policy: EffectPolicy): EffectPolicy {
  return policy.effect === 'external' && policy.confirmation !== 'required'
    ? { effect: 'external', confirmation: 'required' }
    : policy;
}

/** The policy a workspace's own declaration amounts to. */
export function policyFromHint(sideEffect?: SideEffect, confirm?: boolean): EffectPolicy {
  return normalize({
    effect: sideEffect ?? 'state',
    confirmation: confirm ? 'required' : 'optional',
  });
}

/** The stricter of two policies: the higher effect, and confirmation if either asks. */
export function stricterPolicy(a: EffectPolicy, b: EffectPolicy): EffectPolicy {
  return normalize({
    effect: RANK[a.effect] >= RANK[b.effect] ? a.effect : b.effect,
    confirmation:
      a.confirmation === 'required' || b.confirmation === 'required' ? 'required' : 'optional',
  });
}

/** Folds a list of claims into the policy that governs the action. */
export function strictestPolicy(...policies: EffectPolicy[]): EffectPolicy {
  return policies.reduce(stricterPolicy, { effect: 'none', confirmation: 'optional' });
}
