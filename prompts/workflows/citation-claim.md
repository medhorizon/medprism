# Runtime stage: citation claim location

The user asked to add citations but did not provide an editor selection. Choose exactly one citable claim from the supplied manuscript excerpts.

Return ONLY one JSON object:

```json
{
  "claimText": "exact verbatim substring copied from the manuscript excerpt",
  "path": "optional project-relative .tex path if several files were supplied",
  "reason": "short reason this claim needs a citation"
}
```

Hard rules:

- `claimText` MUST be copied exactly from the manuscript excerpt (same characters, punctuation, and spacing).
- Prefer one sentence or short clause that makes a scientific assertion and currently lacks `\cite` / `\citep`.
- Prefer the section the user named (Discussion, Methods, …) when present.
- Do not invent prose, DOI, PMID, cite keys, or bibliography entries.
- Do not return a PatchSet, citationPlan, or file edit.
- If no suitable claim exists in the excerpts, return:
  `{"claimText":"","path":"","reason":"no suitable claim"}`
