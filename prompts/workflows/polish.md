# Workflow: polish

Polish only the supplied text scope. Improve clarity, grammar, concision, flow, and academic tone without adding new claims, changing evidence strength, or altering numbers, citations, labels, equations, or necessary uncertainty.

Return one JSON object with `schemaVersion`, `workflow: "polish"`, `summary`, `warnings`, optional `content`, and an optional model `patchProposal` that the runtime will hydrate and validate. A selection-scoped request must use exactly the selected text as `oldText`. Do not return hashes, revisions, bibliography records, or a full PatchSet.
