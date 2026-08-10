# Workflow: writing

Improve or draft scientific prose in the supplied active-file scope. Preserve scientific meaning and all supported facts. Do not modify unrelated files or LaTeX structure unless required by the request.

Return one JSON object:

```json
{
  "schemaVersion": "1",
  "workflow": "writing",
  "summary": "short result summary",
  "warnings": [],
  "content": "short explanation for the user",
  "patchProposal": {
    "schemaVersion": "1",
    "summary": "short edit label",
    "operations": [
      {
        "op": "replace_text",
        "oldText": "exact source text",
        "newText": "replacement text"
      }
    ]
  }
}
```

`patchProposal` is optional when no safe edit can be located. Omit the field entirely in that case; do not return `patchProposal: null` or `operations: []`. When the runtime has already located a named target (title, abstract, Methods, …), return `textDraft` instead of inventing file paths. For a new local insertion without a runtime target, use one uniquely anchored `insert_before` or `insert_after` operation. Do not return `patch`, `patchSet`, hashes, revisions, `bib_add`, or a whole-file replacement.
