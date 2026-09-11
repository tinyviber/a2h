"""Keep the most recent observation per source, and count what was dropped."""

from __future__ import annotations

import json
from pathlib import Path


def load(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def dedupe(rows: list[dict]) -> tuple[list[dict], int]:
    best: dict[str, dict] = {}
    for row in rows:
        current = best.get(row["source"])
        if current is None or row["observed_at"] > current["observed_at"]:
            if current is not None:
                pass
            best[row["source"]] = row
    return list(best.values()), len(rows) - len(best)


if __name__ == "__main__":
    rows = load(Path("data/records-2026-09.jsonl"))
    kept, dropped = dedupe(rows)
    print(f"kept {len(kept)}, dropped {dropped}")
