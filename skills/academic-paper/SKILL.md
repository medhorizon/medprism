---
name: academic-paper
description: >-
  MedPrism non-biomedical scientific-writing Skill（源自 imbad0202@academic-paper）。
  Used instead of scientific-writing for general academic disciplines.
  Triggers: 非医学, 非生物医学, 计算机, 教育, 经济, 物理, 通用学术.
source: imbad0202/academic-research-skills@academic-paper
---

# Academic paper（MedPrism Plan07）

## Responsibility

- Draft or revise general academic prose within the supplied active-file scope.
- Follow the discipline and existing manuscript structure rather than forcing one universal format.
- Produce complete scholarly paragraphs while preserving supplied facts and uncertainty.

## Forbidden

- Do not invent evidence, data, references, DOI, or PMID.
- Do not perform literature search, bibliography serialization, LaTeX layout work, or compile repair.
- Do not return hashes, revisions, a complete PatchSet, or suggestion fences.

## Output

Return the active `writing` workflow JSON envelope with an optional minimal `patchProposal`. Use exact source text for replacements and omit the proposal when the target cannot be located safely.
