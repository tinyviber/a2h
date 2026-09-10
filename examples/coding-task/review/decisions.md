# Decisions — rate limiter

## 2026-09-09 · Scope

**Decision:** the limiter ships without middleware wiring.

**Why:** the spec excludes it. Wiring it would touch request handling, which
means touching auth, which means this stops being a two-file change. It can be
a second task with its own review.

## 2026-09-09 · Storage

**Decision:** in-process `Map`, no Redis.

**Why:** we have one process. Adding a network dependency to a 100-line limiter
would be the most expensive part of the change. When we scale out, the limiter
is the thing that changes, and that is fine.

**Accepted cost:** restarting the process resets every bucket. Noted in the
spec as acceptable.

## 2026-09-09 · Burst behaviour

**Decision:** a new caller starts with a full bucket.

**Why:** the alternative — starting empty — makes the first request from every
caller wait, which is worse for the common case and surprising for a caller who
has done nothing wrong.

## Open

- Should `prune` be called on a schedule, or left to the caller? Currently
  nothing calls it. Reading the code, that looks like an omission rather than a
  decision.
