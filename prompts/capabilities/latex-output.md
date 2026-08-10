# Capability: LaTeX application

Any accepted text modification is converted to a runtime-owned LaTeX PatchSet. The model does not own file paths, target ranges, wrappers, hashes, revisions, or compilation state.

When a runtime-located target is supplied, return `textDraft` only. For a local source edit without a structured target, return a minimal `patchProposal`. For insertions, prefer `targetKind` and omit `anchor`; runtime places the block at the structurally correct position (e.g. Competing interests among declarations, Discussion among IMRAD sections). Never invent file offsets, hashes, or append prose after `\\end{document}`.
