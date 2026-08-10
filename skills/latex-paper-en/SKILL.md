---
name: latex-paper-en
description: >-
  MedPrism LaTeX-format Skill（源自 bahayonghang@latex-paper-en）。
  Makes minimal formatting/project-structure edits without rewriting scientific content.
  Triggers: 改格式, booktabs, overfull, 换投, IEEE, ACM, 浮动体, 三线表.
source: bahayonghang/academic-writing-skills@latex-paper-en
---

# LaTeX paper（MedPrism Plan07）

## Responsibility

Make the smallest safe LaTeX-format or project-structure change requested, such as:

- document class or package configuration;
- title/front matter and venue-format adjustments;
- table, figure, caption, float, spacing, and layout syntax;
- minimal environment or command restructuring.

## Forbidden

- Do not rewrite scientific claims, results, interpretation, or evidence strength.
- Do not search for or generate citations, DOI, PMID, cite keys, or BibTeX.
- Do not handle compile-log diagnosis; `compile-fix` owns that workflow.
- Do not return hashes, revisions, a complete PatchSet, or suggestion fences.

## Output

Return the active `latex` workflow JSON envelope with an optional minimal `patchProposal`. Runtime code binds paths, validates the Patch, and requires compilation verification after Keep.
