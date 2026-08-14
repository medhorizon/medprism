# Runtime stage: literature search query

The runtime will execute `paper_search`. Propose a keyword query for Europe PMC, PubMed, Crossref, and OpenAlex.

Return ONLY one JSON object:

```json
{
  "query": "short English keyword query",
  "sinceYear": 2021
}
```

Hard rules:

- `query` is a short keyword string (typically 4–12 terms). `AND` / `OR` / parentheses are allowed.
- Do not use PubMed or Europe PMC field tags such as `[Title/Abstract]`, `[dp]`, or `PUB_YEAR`.
- Do not paste the user instruction, a full manuscript sentence, DOI, PMID, cite keys, or bibliographic records.
- Capture the scientific concepts in the selected claim (disease, exposure, outcome, population).
- If the user asked for recency (for example “近5年” or “last 5 years”), set `sinceYear` to the first included four-digit year. Omit `sinceYear` otherwise.
- Do not invent papers. Do not return a citationPlan, PatchSet, or file edit.
