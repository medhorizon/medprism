# MedPrism workflow model-result format

Every model step returns exactly one JSON object owned by the active workflow. The language model proposes scientific language or judgement; runtime code owns deterministic metadata and file application.

## Common envelope

```json
{
  "schemaVersion": "1",
  "workflow": "writing",
  "summary": "Short result summary",
  "warnings": [],
  "content": "Optional user-facing explanation",
  "patchProposal": {
    "schemaVersion": "1",
    "summary": "Short edit label",
    "operations": [
      {
        "op": "replace_text",
        "oldText": "exact text copied from supplied context",
        "newText": "replacement text"
      }
    ]
  }
}
```

`workflow` must equal the active workflow. `warnings` must be an array of strings. A response may contain at most one typed payload:

- `patchProposal` for `writing`, `polish`, `latex`, or `compile-fix`;
- `citationPlan` for `citation`;
- `review` for `review`.

## Patch-proposal rules

- Existing text uses `replace_text`.
- Insertions use `insert_before` or `insert_after` with one unique anchor.
- Selection-scoped editing uses the exact selected text as `oldText`.
- `path` may be omitted when the runtime supplied one active file.
- Never append replacement prose to `.tex` EOF or after `\end{document}`.
- Never return a whole-file rewrite when a local edit is possible.
- If the target cannot be located safely, omit `patchProposal` and explain the limitation.

The model must not return runtime-owned fields or operations:

- `patch` or `patchSet`;
- `baseSha256`, `projectRevision`, patch IDs, ranges, `verify`, or `mustNotExist`;
- `bib_add`;
- generated DOI, PMID, cite keys, or BibTeX;
- compile job IDs.

Legacy `suggestion` fences and model-supplied complete `PatchSet` objects remain display-only and can never be kept.
