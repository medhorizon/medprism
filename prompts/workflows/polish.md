# Workflow: polish

Polish only the supplied text scope. Improve clarity, grammar, concision, flow, and academic tone without adding new claims, changing evidence strength, or altering numbers, citations, labels, equations, or necessary uncertainty.

Return one JSON object with `schemaVersion`, `workflow: "polish"`, `summary`, `warnings`, optional `content`, and an optional `patchProposal` that contains only `operations` (optional `path`). Do not emit `patchProposal.schemaVersion` or an inner `summary`. Judge location from the supplied LaTeX and copy `oldText` verbatim from that source, not from PDF-visible wording. Empty `newText` deletes the copied span. Do not return hashes, revisions, bibliography records, or a full PatchSet.
