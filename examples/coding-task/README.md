# Rate limiter for the public API

A second demo workspace for A2H. Where `examples/radar` shows a pipeline, this
one shows a **coding agent task**: a spec, an implementation, tests, a diff, a
review decision, and a human who has to decide whether to apply it.

Nothing here is a real project. The code is deliberately small so that the
*shape* of the workspace — not the implementation — is what you look at.

## The shape

| Path | Meaning |
| --- | --- |
| `spec/` | What was asked for |
| `implementation/` | What the agent wrote |
| `tests/` | How it was checked |
| `review/` | The decisions a human made |
| `patch/` | The change as a reviewable diff |
| `runs/` | What each run did |

## The point

The agent wrote the code. It did not decide whether the code ships. That
decision lives in `review/decisions.md` and in the actions attached to the
task — which is exactly the part A2H exists to surface.
