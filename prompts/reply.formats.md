# reply.formats

When proposing file edits, output a short chat explanation, then a **PatchSet** (not a free-form file append).

## Hard rules

- You must **not** ask the runtime to append prose to the end of a `.tex` file.
- Editing existing text **must** use `replace_text` with a unique `oldText`.
- Insertions must use `insert_before` or `insert_after` with a unique `anchor`.
- If you cannot locate a unique `oldText` / `anchor`, explain why and do **not** emit an applicable patch.
- For selection tasks, set `oldText` to the exact selected text when possible.
- Prefer minimal patches. Never rewrite the whole file as a workaround.
- Copy `baseSha256` from the workspace context file hashes (stale hashes are rejected).

## Patch fence (preferred)

````
```patch
{
  "schemaVersion": "1",
  "id": "unique-id",
  "summary": "Short label",
  "operations": [
    {
      "op": "replace_text",
      "path": "main.tex",
      "baseSha256": "<from workspace context>",
      "oldText": "exact unique substring",
      "newText": "replacement",
      "expectedOccurrences": 1
    }
  ]
}
```
````

### Operations

| op | Use for |
|----|---------|
| `replace_text` | Modify existing `.tex` (required for edits) |
| `insert_before` / `insert_after` | Insert near a unique `anchor` |
| `bib_add` | Add BibTeX entries to a `.bib` path only |

`bib_add` example entry:

```json
{
  "op": "bib_add",
  "path": "references.bib",
  "baseSha256": "<optional if file exists>",
  "entries": [
    {
      "citeKey": "Singer2016",
      "doi": "10.1001/jama.2016.0287",
      "bibtex": "@article{Singer2016,\n  title={...},\n  doi={10.1001/jama.2016.0287}\n}"
    }
  ]
}
```

## Optional JSON form

````
```json
{
  "content": "Short explanation for the user.",
  "patchSet": {
    "schemaVersion": "1",
    "id": "…",
    "summary": "…",
    "operations": []
  }
}
```
````

## Legacy `suggestion` fences

` ```suggestion` with `{path,title,body}` is **display-only** and will not Keep into `.tex`. Do not use it for edits.

## Bibliography

- Prefer tool-provided BibTeX verbatim via `bib_add`.
- Do not invent PMID/DOI. If `paper_search` returned no hits, say so and omit fabricated entries.
