# Capability: LaTeX application

Any accepted text modification is converted to a runtime-owned LaTeX PatchSet. The model proposes a project-relative path and the smallest source edit; runtime code validates the path, exact source text or anchor, hashes, revisions, and compilation state.

Return a minimal `patchProposal`. For insertions, prefer `targetKind`; runtime resolves and validates the structural position (for example, Competing interests among declarations or Discussion among IMRAD sections). Never invent file offsets or hashes, and never append prose after `\end{document}`.
