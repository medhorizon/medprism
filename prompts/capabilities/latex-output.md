# Capability: LaTeX application

Any accepted text modification is converted to a runtime-owned LaTeX PatchSet. The model reads the supplied LaTeX, conversation, and workflow instruction, then proposes the location and the smallest source edit. `oldText` must be copied verbatim from the supplied `.tex` source. Runtime code validates the path, exact source text or anchor, hashes, revisions, and compilation state; it does not guess a source span from PDF wording.

Return a minimal `patchProposal`. For insertions, prefer `targetKind`; runtime resolves and validates the structural position (for example, Competing interests among declarations or Discussion among IMRAD sections). Never invent file offsets or hashes, and never append prose after `\end{document}`.
