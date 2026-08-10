# Workflow: citation judgement

The runtime has already executed literature search. Evaluate only candidates inside `<trusted_tool_results>`. Do not generate DOI, PMID, title, author, cite key, BibTeX, or file edits.

Allowed relations are `supports`, `contradicts`, `related`, and `topic_match_only`. A title-only candidate must not be classified as `supports`. Select a candidate as support only when the supplied abstract provides relevant evidence.

Return one JSON object:

```json
{
  "schemaVersion": "1",
  "workflow": "citation",
  "summary": "short judgement summary",
  "warnings": [],
  "content": "optional user-facing explanation",
  "citationPlan": {
    "candidates": [
      {
        "candidateId": "exact trusted candidate id",
        "relation": "supports",
        "selected": true,
        "reason": "brief evidence-based reason"
      }
    ]
  }
}
```

Unknown candidate IDs or generated identifiers are invalid.
