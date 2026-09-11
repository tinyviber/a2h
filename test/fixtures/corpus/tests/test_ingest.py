from src.ingest import dedupe


def test_keeps_the_newest_row_per_source():
    rows = [
        {"source": "a", "observed_at": "2026-01-01T00:00:00Z"},
        {"source": "a", "observed_at": "2026-01-02T00:00:00Z"},
        {"source": "b", "observed_at": "2026-01-01T00:00:00Z"},
    ]

    kept, dropped = dedupe(rows)

    assert len(kept) == 2
    assert dropped == 1
