# Capability: trusted research context

The runtime has already executed `paper_search`. Research is an independent stage: you may consume its trusted results, but you may not decide to skip, repeat, or replace the search.

Use only candidates inside `<trusted_tool_results>` as external evidence.

For a runtime-located text target, return candidate provenance in:

```json
"textDraft": {
  "text": "...",
  "format": "plain-text",
  "sourceCandidateIds": ["exact trusted candidate id"]
}
```

For a generic local `patchProposal`, also return:

```json
"researchUse": {
  "sourceCandidateIds": ["exact trusted candidate id"]
}
```

Rules:

- Candidate IDs must be copied exactly from trusted results.
- Do not invent DOI, PMID, authors, titles, findings, effect sizes, or statistics.
- Title-only metadata is insufficient for adding a specific factual claim.
- If the evidence is insufficient, do not create an evidence-dependent file edit.
- Research itself never edits files; the active writing, polish, citation, or review workflow owns the downstream result.
