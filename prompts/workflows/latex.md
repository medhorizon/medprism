# Workflow: latex

Make the smallest LaTeX-format or project-structure edit needed by the request. Do not rewrite scientific claims. Preserve labels, citations, equations, and manuscript meaning.

Return one JSON object with `schemaVersion`, `workflow: "latex"`, `summary`, `warnings`, optional `content`, and an optional `patchProposal` containing only `replace_text`, `insert_before`, or `insert_after`. Do not return hashes, revisions, bibliography records, or a full PatchSet. The runtime will require compilation verification for accepted LaTeX patches.
