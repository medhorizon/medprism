---
name: literature-cite
description: Deprecated migration material. Do not load in MedPrism runtime; use the citation workflow with nature-citation instead.
status: deprecated
---

# Literature cite (deprecated, do not enable)

This adapter is retained only to explain the migration from the old suggestion
fence protocol. It is not registered or imported by the MedPrism runtime.

Do not follow the old instructions below. In particular, do not emit
`suggestion` fences, BibTeX, cite keys, or direct file edits from a model.
Those operations now belong to the trusted citation runtime. Use
`skills/nature-citation/SKILL.md` for candidate judgement only.

## Migration notes

The supported flow is: runtime search -> candidate-only judgement -> runtime
metadata verification -> runtime cite-key/BibTeX allocation -> atomic `.tex` +
`.bib` transaction.
