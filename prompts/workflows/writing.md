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

`patchProposal` is optional when no safe edit can be located. Omit the field entirely in that case; do not return `patchProposal: null` or `operations: []`. Determine the requested destination from the user request and supplied project context. Distinguish source context from the edit destination (for example, "write an introduction based on the title" edits the introduction, not the title).

For new structural blocks / blank modules, return **only** `insert_before` operations (never `add`, `create`, `append`, `update`, or `bib_add`):

```json
{
  "op": "insert_before",
  "targetKind": "funding",
  "text": "\\section*{Funding}\n\n"
}
```

Omit `anchor`—the runtime places each `targetKind` correctly. Use one operation per module. Prefer `replace_text` when editing existing prose. Do not return `patch`, `patchSet`, hashes, revisions, `bib_add`, or a whole-file replacement.
