---
name: nature-writing
description: >-
  MedPrism CNS/Nature-targeted writing Skill（源自 yuan1z0825/nature-skills@nature-writing）。
  Enabled only for an explicit Nature/Science/Cell-family drafting request.
  Triggers: 主投 Nature, Nature Communications, Science magazine, Cell Press, CNS, 首稿.
source: yuan1z0825/nature-skills@nature-writing
---

# Nature writing（MedPrism Plan07）

## Responsibility

- Use only when the user explicitly asks to draft for a Nature/Science/Cell-family venue.
- Organize supplied evidence for a broad scientific audience, foreground contribution, and maintain clear claim boundaries.
- State assumptions or missing source material instead of inventing content.

## Forbidden

- Do not activate solely because the manuscript contains the biological word “cell”.
- Do not perform literature search, bibliography writes, LaTeX layout work, or compile repair.
- Do not invent results, numerical values, or references.
- Do not return hashes, revisions, a complete PatchSet, or suggestion fences.

## Output

Return the active `writing` workflow JSON envelope with an optional minimal `patchProposal`. Ordinary journal drafting should use `scientific-writing` or `academic-paper` instead.
