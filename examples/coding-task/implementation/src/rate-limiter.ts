/**
 * Token-bucket rate limiter, keyed by caller id.
 *
 * Contract (see spec/rate-limiter.md):
 *   - one bucket per key
 *   - burst up to `capacity`
 *   - continuous refill, computed on read — no timers
 *   - a rejected call reports how long the caller should wait
 */

export interface LimiterOptions {
  /** Maximum tokens a bucket can hold. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
}

export interface Decision {
  allowed: boolean;
  /** Tokens left after this call. */
  remaining: number;
  /** Milliseconds until the next token, when rejected. */
  retryAfterMs: number;
}

interface Bucket {
  tokens: number;
  updatedAtMs: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly capacity: number;
  private readonly refillPerSecond: number;

  constructor(options: LimiterOptions) {
    if (options.capacity <= 0) throw new Error('capacity must be positive');
    if (options.refillPerSecond <= 0) throw new Error('refillPerSecond must be positive');
    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
  }

  /**
   * Records one call from `key` and reports whether it is allowed.
   * Never throws; a malformed key is treated as its own bucket.
   */
  check(key: string, nowMs: number = Date.now()): Decision {
    const bucket = this.refill(key, nowMs);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }

    const deficit = 1 - bucket.tokens;
    const retryAfterMs = Math.ceil((deficit / this.refillPerSecond) * 1000);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  /** Drops idle buckets. Optional; nothing calls it on a schedule. */
  prune(olderThanMs: number, nowMs: number = Date.now()): number {
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (nowMs - bucket.updatedAtMs > olderThanMs) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  private refill(key: string, nowMs: number): Bucket {
    const existing = this.buckets.get(key);
    if (!existing) {
      // A new caller starts with a full bucket, which is what makes bursts work.
      const fresh: Bucket = { tokens: this.capacity, updatedAtMs: nowMs };
      this.buckets.set(key, fresh);
      return fresh;
    }

    const elapsedMs = Math.max(0, nowMs - existing.updatedAtMs);
    const gained = (elapsedMs / 1000) * this.refillPerSecond;
    existing.tokens = Math.min(this.capacity, existing.tokens + gained);
    existing.updatedAtMs = nowMs;
    return existing;
  }
}
