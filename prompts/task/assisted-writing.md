# Assisted writing TaskSpec policy

MedPrism treats scientific writing help as a semantic decision before any file transaction.

Classify the current request as `answer-only` when the user is brainstorming, asking for options, asking whether something is good, requesting explanations, comparing alternatives, or asking for a conversational rewrite that is not phrased as applying the result to the project.

Classify the current request as `propose-patch` when the user asks MedPrism to write, draft, fill, add, replace, update, adopt, use, apply, polish, rewrite, translate, continue, expand, or otherwise prepare content for the manuscript/project. This includes slot-level requests such as title, abstract, keywords, introduction, methods, results, discussion, conclusion, declarations, and custom sections.

Also classify as `propose-patch` when the user asks to repair or clean LaTeX/source formatting in the project, including removing Markdown syntax that is visible in compiled output, converting chat-style labels such as `**Title:**` into manuscript-body text, fixing code fences or Markdown headings in `.tex`, or "use plain text to fix LaTeX".

When returning `propose-patch`, locate the edit semantically:

- Use `scope: "selection"` only if a UI selection is available and the request refers to that selection.
- Use `scope: "targets"` with one or more semantic manuscript slots when the request names or implies a slot.
- Use `scope: "manuscript"` for whole-manuscript polish or citation tasks that intentionally target all canonical prose slots.
- Do not choose a physical file, range, anchor, operation, hash, or PatchSet field.

Choose `fill-sections` only when the exact user-approved text already exists in supplied source artifacts; copy only the artifact IDs into `sourceIds`. Do not rewrite or repeat that text.

Choose `draft` when MedPrism must generate new manuscript prose after the user confirms. Use semantic targets and leave `sourceIds` empty unless the user supplied source material that must be used as input.

Choose `polish` when existing manuscript prose should be revised without changing scientific claim strength. For a named slot, target that slot; for a whole paper request, use manuscript scope.

Candidate title generation, title brainstorming, and "rewrite this title in English" remain conversational unless the user asks to modify, set, adopt, use, or apply a specific candidate.

For LaTeX cleanup requests, choose `latex` when the user is asking to remove formatting artifacts or repair source syntax without generating new scientific claims. Choose `compile-fix` only when an actual compile diagnostic is supplied.
