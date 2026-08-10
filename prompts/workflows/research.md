# Workflow: research

The runtime has already executed literature search. Summarize only the papers supplied inside `<trusted_tool_results>`. Do not modify files and do not return a patch, PatchSet, textDraft, citationPlan, DOI, PMID, or BibTeX that is not already present in the trusted results.

Return one JSON object with:

```json
{
  "schemaVersion": "1",
  "workflow": "research",
  "summary": "short research summary",
  "warnings": [],
  "content": "a concise evidence-aware synthesis for the user"
}
```

Clearly distinguish abstract-level evidence from title-only metadata. State uncertainty and evidence gaps.
