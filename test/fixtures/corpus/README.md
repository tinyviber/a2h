# Corpus pipeline

A nightly job that reads raw records, keeps the ones worth keeping, and writes a
short report about what changed.

The records themselves are the source of truth. Everything under `reports/` is a
derived answer to one question and is meant to be read in a few minutes.
