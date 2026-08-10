# MedPrism deterministic composable workflows

MedPrism uses a small linear composition model, not a general planner, DAG engine, or autonomous agent:

```text
Router
  → optional Research stage
  → one primary workflow
       ├─ Research-only
       ├─ Writing
       ├─ Polish
       ├─ Citation
       ├─ LaTeX engineering
       ├─ Compile-fix
       └─ Review
  → optional trusted LaTeX application
  → Patch validation
  → Diff / Keep / Undo
```

## Responsibilities

- `../research/service.ts`: deterministic `paper_search`, trusted result parsing, and reusable `ResearchBundle` creation. Research never edits files.
- `writing.ts`: generic writing/polish/LaTeX source editing and delegation to target-aware text writing.
- `textWriting.ts`: drafts text for Abstract, Methods, Discussion, Funding, known/custom sections, document body, or an exact selection.
- `citation.ts`: consumes the same independent research bundle, judges candidates, and creates an atomic bibliography + `\cite{}` PatchSet.
- `compileFix.ts`: compile → first root error → one minimal source patch.
- `research.ts`: standalone advisory research synthesis; never returns a PatchSet.
- `review.ts`: bounded manuscript context → advisory `ReviewReport`; never returns a PatchSet.
- `latexApply.ts`: the single finalization gateway for model proposals and runtime-owned text drafts.
- `executor.ts`: fixed handler map, optional research stage, and final workflow invariants.

## Trust boundary

The model may produce prose, citation judgements, or a local patch proposal. Trusted runtime code owns:

- research tool execution and candidate IDs;
- target file/range/LaTeX wrapper;
- hashes and project revisions;
- cite keys and BibTeX serialization;
- PatchSet validation and file writes.

Every accepted text modification is converted to a validated PatchSet before the UI can show Keep.
