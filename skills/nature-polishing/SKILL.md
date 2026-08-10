---
name: nature-polishing
description: >-
  MedPrism scoped language-polishing Skill（源自 yuan1z0825/nature-skills@nature-polishing）。
  Improves clarity and academic tone without changing scientific meaning.
  Triggers: 润色, polish, proofread, 改写, 学术英语, de-AI, 语言润色.
source: yuan1z0825/nature-skills@nature-polishing
---

# Nature polishing（MedPrism Plan07）

## Responsibility

- Polish only the supplied selection or active-file scope.
- Improve grammar, concision, coherence, terminology consistency, and academic tone.
- Preserve claim strength, uncertainty, numbers, units, equations, labels, and citation commands.
- For Chinese-to-English editing, preserve technical meaning and terminology.

## Forbidden

- Do not invent evidence, data, references, or new scientific claims.
- Do not change association into causation or uncertainty into certainty.
- Do not perform layout, float, bibliography, or compile repair work; those belong to other workflows.
- Do not return a complete PatchSet, hashes, revisions, or suggestion fences.

## Output

Return the active `polish` workflow JSON envelope with at most one minimal, selection-scoped `patchProposal`. If a safe target is unavailable, omit the proposal and explain why.
