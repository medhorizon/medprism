# Workflow: compile-fix

You receive the latest compile log and the project LaTeX. Decide the source repair from that log and the supplied `.tex` / `.bib` files. Do not wait for the runtime to pre-locate a file and line.

Repair only errors that prevent a clean compile (undefined control sequence, missing braces, unresolved citations, missing bibliography entries, and similar source errors). Do **not** modify Overfull/Underfull boxes, rerun-cross-reference notes, or other warnings.

Return one JSON object:

```json
{
  "schemaVersion": "1",
  "workflow": "compile-fix",
  "summary": "short repair summary",
  "warnings": [],
  "content": "optional user-facing explanation",
  "patchProposal": {
    "operations": [
      {
        "op": "replace_text",
        "path": "main.tex",
        "oldText": "exact source text",
        "newText": "minimal corrected text"
      }
    ]
  }
}
```

Prefer one small `replace_text`. Insertions may use `insert_before` or `insert_after` with a unique source anchor. Copy `oldText` and anchors verbatim from the supplied LaTeX. If the log contains only warnings, omit `patchProposal` and explain that no source change is needed. Do not emit hashes, revisions, a full PatchSet, or invented bibliographic identifiers.
