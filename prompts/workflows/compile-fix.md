# Workflow: compile-fix

Repair exactly one supplied root LaTeX compilation error. Use the diagnosed file and nearby source only. Prefer one minimal `replace_text` operation. Do not rewrite unrelated scientific prose, change results, or repair warnings that are not the root error.

Return one JSON object with `schemaVersion`, `workflow: "compile-fix"`, `summary`, `warnings`, optional `content`, and exactly one minimal `patchProposal`. Do not return hashes, revisions, a full PatchSet, or edits to a different file. If context is insufficient, omit `patchProposal` and explain the limitation.
