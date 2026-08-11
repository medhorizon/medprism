---
name: nature-citation
description: Judge trusted literature-search candidates for a selected claim; the runtime owns search, metadata verification, cite keys, BibTeX, and atomic edits.
source: yuan1z0825/nature-skills@nature-citation
adapterStatus: staged
---

# Citation judgement (MedPrism staged adapter)

## Use when

Use only after the runtime has supplied a `paper_search` result set for the
selected claim. This skill does not search, export references, or edit files.

## Inputs and evidence rule

Read only candidates inside `<trusted_tool_results source="paper_search">`.
Candidate IDs are opaque trusted values. A title-only record is never enough
for `supports`; use the supplied abstract or evidence snippet and report
uncertainty when support is incomplete.

## Behavior and voice

Use conservative relations: `supports`, `contradicts`, `related`, or
`topic_match_only`. Select only candidates that directly support the claim.
Keep the reason short and evidence-based. Do not invent, normalize, or repeat
bibliographic metadata or identifiers.

## Output

Return the active `citation` envelope with exactly one `citationPlan` payload:

```json
{"citationPlan":{"candidates":[{"candidateId":"trusted-id","relation":"supports","selected":true,"reason":"abstract evidence"}]}}
```

Each row may contain only `candidateId`, `relation`, `selected`, and `reason`;
copy the ID exactly from trusted results. Omit file paths, claim ranges, DOI,
PMID, title, authors, cite keys, BibTeX, `patchProposal`, and suggestion
fences. The runtime binds the claim, verifies metadata, allocates keys, and
creates the atomic `.tex` + `.bib` transaction.
