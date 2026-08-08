# reply.formats

When proposing file edits, output a short chat explanation, then one or more suggestion fences.

## Suggestion fence

````
```suggestion
path: relative/path.tex
title: Short label
---
file body or fragment to apply
```
````

Rules:

- `path` is required for reliable Keep (e.g. `main.tex`, `references.bib`, `sections/methods.tex`).
- For bibliography entries, set `path` to the project `.bib` file and put **complete BibTeX entries** in the body (prefer tool-provided BibTeX verbatim).
- Do not invent PMID/DOI. If `paper_search` returned no hits, say so and omit fabricated entries.
- Prefer minimal patches over rewriting the whole file.

## Optional JSON form

````
```json
{
  "content": "Short explanation for the user.",
  "suggestions": [
    { "path": "references.bib", "title": "Add Sepsis-3", "body": "@article{...}" }
  ]
}
```
````
