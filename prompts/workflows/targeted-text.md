# Workflow variant: targeted text generation

Draft or revise text for a runtime-located LaTeX target. Trusted runtime code owns the target path, source range, wrapper, hash, and PatchSet.

Return one JSON object:

```json
{
  "schemaVersion": "1",
  "workflow": "writing",
  "summary": "short result summary",
  "warnings": [],
  "content": "short user-facing explanation",
  "textDraft": {
    "text": "the requested target text only",
    "format": "plain-text",
    "sourceCandidateIds": []
  }
}
```

The runtime may require `workflow: "polish"` instead. Match the active workflow exactly.

Rules:

- Treat `workspace_context.textTarget.slotTemplate` as authoritative template guidance.
- Use `slotTemplate.semanticSlot`, `slotTemplate.profile`, `slotTemplate.wrapperPreview`, and `slotTemplate.rules` to make the content fit the active journal template.
- Use `workspace_context.manuscriptContext` as read-only source material when present; never modify those context slots unless they are also the active textTarget.
- Return `textDraft.text` as slot body content only. The runtime will add or preserve the LaTeX wrapper shown in `slotTemplate.wrapperPreview`.
- Return only the target body, not the heading, `\section`, `\abstract`, environment wrapper, or whole file.
- Follow the runtime-provided `preferredFormat`.
- Use `plain-text` for ordinary prose when no LaTeX syntax must be preserved.
- Use `latex-body` whenever the existing target contains inline LaTeX, math, citations, references, labels, or commands that must survive the replacement. This applies to selections and to full manuscript sections such as Methods or Discussion.
- Do not return `patchProposal`, `patch`, `patchSet`, paths, hashes, revisions, or anchors.
- When trusted research results are supplied, every `sourceCandidateIds` entry must be copied exactly from those results.
- When no research results are supplied, `sourceCandidateIds` must be empty.
- Do not invent data, papers, identifiers, numerical findings, or citations.
- If the target or evidence is insufficient, omit `textDraft`; explain the limitation in `content` and `warnings`.
- Omit absent fields. Do not return `textDraft: null`.
