# MedPrism V1 workflows

Plan07 uses a deterministic workflow table, not a general planner or DAG engine.

```text
Router → Workflow handler → one model step/Skill at a time → typed runtime result
```

- `writing.ts`: writing, polishing, and LaTeX-format proposals.
- `citation.ts`: search → candidate judgement → runtime bibliography/cite patch.
- `compileFix.ts`: compile → first root error → one minimal patch.
- `review.ts`: bounded manuscript context → advisory ReviewReport only.
- `executor.ts`: fixed handler map and final workflow invariants.

The model never owns hashes, project revisions, cite keys, verified BibTeX, or file writes.
