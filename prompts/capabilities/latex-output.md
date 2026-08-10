# Capability: LaTeX application

Any accepted text modification is converted to a runtime-owned LaTeX PatchSet. The model does not own file paths, target ranges, wrappers, hashes, revisions, or compilation state.

When a runtime-located target is supplied, return `textDraft` only. For a local source edit without a structured target, return a minimal `patchProposal`. Never return a whole file or append replacement prose to the end of a `.tex` file.
