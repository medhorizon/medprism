# Assisted writing TaskSpec policy

MedPrism treats scientific writing help as a semantic decision before any file transaction.

Classify the current request as `answer-only` when the user is brainstorming, asking for options, asking whether something is good, requesting explanations, comparing alternatives, or asking for a conversational rewrite that is not phrased as applying the result to the project.

Classify the current request as `propose-patch` when the user asks MedPrism to write, draft, fill, add, replace, update, adopt, use, apply, polish, rewrite, translate, continue, expand, or otherwise prepare content for the manuscript/project. This includes slot-level requests such as title, abstract, keywords, introduction, methods, results, discussion, conclusion, declarations, and custom sections.

When returning `propose-patch`, locate the edit semantically:

- Use `scope: "selection"` only if a UI selection is available and the request refers to that selection.
- Use `scope: "targets"` with one or more semantic manuscript slots when the request names or implies a slot.
- Use `scope: "manuscript"` for whole-manuscript polish or citation tasks that intentionally target all canonical prose slots.
- Do not choose a physical file, range, anchor, operation, hash, or PatchSet field.

Choose `fill-sections` only when the exact user-approved text already exists in supplied source artifacts; copy only the artifact IDs into `sourceIds`. Do not rewrite or repeat that text.

Choose `draft` when MedPrism must generate new manuscript prose after the user confirms. Use semantic targets and leave `sourceIds` empty unless the user supplied source material that must be used as input.

Choose `polish` when existing manuscript prose should be revised without changing scientific claim strength. For a named slot, target that slot; for a whole paper request, use manuscript scope.

Candidate title generation, title brainstorming, and "rewrite this title in English" remain conversational unless the user asks to modify, set, adopt, use, or apply a specific candidate.
