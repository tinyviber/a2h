# Signal Radar

A daily agent workflow that watches a set of sources, clusters what it finds,
and leaves publish candidates for a human to approve or reject.

This is a **demo workspace** for A2H. All sources, vendors, and items in it are
invented; nothing here refers to anything real. Its purpose is to show what an
agent workspace looks like when the producer states its own semantics instead
of leaving A2H to guess.

## What a run does

1. **Ingest** — pull the configured feeds into `inbox/`.
2. **Cluster** — group items that describe the same event into `processed/`.
3. **Draft** — write a publish candidate for each surviving cluster.
4. **Pause** — hand the candidates to a human.

Step 4 is the point. The pipeline stops and waits, because the judgement call
("is this worth publishing?") is not the agent's to make.

## Where things are

| Path | Meaning |
| --- | --- |
| `sources/` | Feed configuration and the ingest log |
| `inbox/` | Raw items as they arrived, one file each |
| `processed/` | Cluster assignments and the dedupe report |
| `publish-candidates/` | Drafts awaiting a human decision |
| `runs/` | Human-readable run summaries |
| `visuals/` | Coverage chart produced by the cluster step |

## The protocol files

`.a2h/manifest.json` declares the groups, tasks, runs and actions for this
workspace. `.a2h/runs/` holds one JSON file per run, so the pipeline can append
a run record without rewriting the manifest.

Two of the files in `publish-candidates/` carry their semantics in frontmatter
instead, which is the cheapest way for a producer to annotate a single
document.
