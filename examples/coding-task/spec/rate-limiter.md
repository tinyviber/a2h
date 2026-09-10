# Spec — per-caller rate limiting

## What we need

A limiter that caps how often a single caller can hit the public API.

## Agreed behaviour

- **Bucket per caller.** Callers are identified by a string key the middleware
  supplies. The limiter does not parse headers itself.
- **Burst allowed.** A caller may spend a full bucket at once.
- **Smooth refill.** Tokens accrue continuously, not in whole-second steps.
- **Cheap.** No background timers. Refill is computed when a caller asks.
- **Explicit results.** A rejected call returns the retry delay, so the caller
  can send a `Retry-After` without guessing.

## Out of scope

- Wiring the middleware. That is a separate change and a separate decision.
- Distributed state. One process, one Map. If we need shared limits later, that
  is a different design with a different dependency.
- Persistence. Restarting the process resets every bucket, and that is
  acceptable.

## Why the boundaries matter

The two things most likely to go wrong here are scope creep into the middleware
layer and a background timer per bucket. Both are excluded above on purpose.
