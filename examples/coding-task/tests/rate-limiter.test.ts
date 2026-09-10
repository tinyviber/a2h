import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../implementation/src/rate-limiter';

const T0 = 1_700_000_000_000;

describe('RateLimiter', () => {
  it('allows a full burst, then rejects', () => {
    const limiter = new RateLimiter({ capacity: 3, refillPerSecond: 1 });
    expect(limiter.check('a', T0).allowed).toBe(true);
    expect(limiter.check('a', T0).allowed).toBe(true);
    expect(limiter.check('a', T0).allowed).toBe(true);
    expect(limiter.check('a', T0).allowed).toBe(false);
  });

  it('reports a retry delay the caller can use', () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 0.5 });
    limiter.check('a', T0);
    const rejected = limiter.check('a', T0);
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterMs).toBe(2000);
  });

  it('refills continuously rather than in whole seconds', () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 1 });
    limiter.check('a', T0);
    expect(limiter.check('a', T0 + 999).allowed).toBe(false);
    expect(limiter.check('a', T0 + 1001).allowed).toBe(true);
  });

  it('never exceeds capacity after a long idle period', () => {
    const limiter = new RateLimiter({ capacity: 2, refillPerSecond: 10 });
    limiter.check('a', T0);
    const decision = limiter.check('a', T0 + 60_000);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBeLessThanOrEqual(2);
  });

  it('isolates callers from each other', () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 1 });
    expect(limiter.check('a', T0).allowed).toBe(true);
    expect(limiter.check('b', T0).allowed).toBe(true);
  });

  it('tolerates a clock that moves backwards', () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 1 });
    limiter.check('a', T0 + 5000);
    const decision = limiter.check('a', T0);
    expect(decision.allowed).toBe(false);
  });

  it('prunes idle buckets', () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 1 });
    limiter.check('a', T0);
    limiter.check('b', T0);
    expect(limiter.prune(1000, T0 + 5000)).toBe(2);
  });

  it('rejects a nonsensical configuration at construction', () => {
    expect(() => new RateLimiter({ capacity: 0, refillPerSecond: 1 })).toThrow();
    expect(() => new RateLimiter({ capacity: 1, refillPerSecond: 0 })).toThrow();
  });

  it('reports remaining tokens as a whole number', () => {
    const limiter = new RateLimiter({ capacity: 5, refillPerSecond: 1 });
    limiter.check('a', T0);
    const second = limiter.check('a', T0 - 2000);
    expect(Number.isInteger(second.remaining)).toBe(true);
  });
});
