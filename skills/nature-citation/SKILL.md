---
name: nature-citation
description: >-
  MedPrism citation-judgement Skill. Evaluates trusted literature-search
  candidates for a selected scientific claim. It never generates identifiers,
  BibTeX, cite keys, or file edits.
source: yuan1z0825/nature-skills@nature-citation
---

# Nature citation — candidate judgement only

## Responsibility

- Evaluate only candidates supplied by the runtime `paper_search` step.
- Classify each candidate as `supports`, `contradicts`, `related`, or `topic_match_only`.
- Select support only when the supplied abstract contains relevant evidence.
- Explain the judgement briefly and identify uncertainty.

## Forbidden

- Do not invent or rewrite DOI, PMID, title, author, journal, year, or candidate ID.
- Do not generate BibTeX or cite keys.
- Do not modify `.tex` or `.bib` files.
- Do not classify a title-only match as `supports`.

The trusted runtime verifies metadata, allocates cite keys, serializes BibTeX, and creates one atomic bibliography + citation PatchSet.
