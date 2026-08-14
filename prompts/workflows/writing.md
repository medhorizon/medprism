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

`patchProposal` is optional when no safe edit can be located. Omit the field entirely in that case; do not return `patchProposal: null` or `operations: []`. Return only `operations` (optional `path`). Do not emit `patchProposal.schemaVersion` or an inner `summary`; the runtime copies those from this envelope.

Judge the edit location and replacement from the supplied LaTeX (`mainDocument`, `texDocuments`, file tree, and `editor.selectedText` when present), the conversation, and this instruction. `oldText` and insert `anchor` must be copied verbatim from that source. Do not use PDF-visible wording, rendered labels, or a paraphrase from the user message as the locate key. Empty `newText` deletes the copied source span. Distinguish source context from the edit destination (for example, "write an introduction based on the title" edits the introduction, not the title). Uploaded images are project files for later `\\includegraphics`; they are not a locate key and do not change insert position.

For new structural blocks / blank modules, return **only** `insert_before` operations (never `add`, `create`, `append`, `update`, or `bib_add`):

```json
{
  "op": "insert_before",
  "targetKind": "funding",
  "text": "\\section*{Funding}\n\n"
}
```

Omit `anchor`—the runtime places each `targetKind` correctly. Use one operation per module. Prefer `replace_text` when editing existing prose. Do not return `patch`, `patchSet`, hashes, revisions, `bib_add`, or a whole-file replacement.
