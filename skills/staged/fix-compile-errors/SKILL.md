---
name: fix-compile-errors
description: Diagnose LaTeX compile failures from the supplied compile log and project source, and identify the smallest source correction. Use only for compile-fix workflows. Do not repair warnings.
---

# Fix Compile Errors

## Scope

Reason from the supplied compile log and project LaTeX. Address the source
error that prevents a clean compile.

## Professional Judgement

- Identify the earliest source-level cause supported by the log.
- Prefer one local correction over restructuring surrounding content.
- Account for command arguments, environment balance, package availability,
  escaping, math mode, citations, and file references when the evidence
  points there.
- Do not repair Overfull/Underfull boxes or other warnings.

## Preserve

Preserve scientific prose, numbers, equations, citations, labels, and project
structure unless the compile error directly requires a narrow change.

## Boundaries

Do not invent bibliography records, DOI, PMID, or cite keys. Do not rewrite
prose. Do not assume a package or resource exists when it was not supplied.

## Insufficient Evidence

When the log and source do not identify a unique safe repair, omit the patch
and state what additional source or log context is required.
