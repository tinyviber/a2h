# Run note — 2026-09-09

## What I did

Read the spec, wrote `implementation/src/rate-limiter.ts`, then wrote the tests
before running them. Nine cases pass on the first attempt, including the clock
skew case, which is the one I expected to fail.

## What I did not do

- Did not wire the middleware. The spec puts that out of scope and I agree with
  the reason given.
- Did not add a background prune timer. `prune` exists but nothing calls it.

  This is the one thing I would flag: it is reachable code that nothing
  exercises, which means it will rot. Either something should call it, or it
  should not exist.

- Did not add persistence. Also out of scope.

## Where I am least confident

The `remaining` value is reported as a floor. On a partial refill it will look
like a caller has fewer tokens than they do. That is the right direction to err
in for a limiter, but it is a choice, not an accident.

## What I need from a human

A decision on the patch. I have not applied it anywhere; it is in `patches/`.
