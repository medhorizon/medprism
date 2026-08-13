---
name: fix-compile-errors
description: Diagnose one runtime-supplied root LaTeX compilation error and identify the smallest source correction. Use only for compile-fix workflows with a root diagnostic and nearby source.
---

# Fix Compile Errors

## Scope

Reason from the supplied root compiler diagnostic and nearby LaTeX source.
Address one root error at a time.

## Professional Judgement

- Identify the earliest source-level cause supported by the diagnostic.
- Prefer one local correction over restructuring surrounding content.
- Account for command arguments, environment balance, package availability,
  escaping, math mode, and file references when the evidence points there.
- Avoid speculative repairs to secondary warnings.

## Preserve

Preserve scientific prose, numbers, equations, citations, labels, and project
structure unless the root syntax error directly requires a narrow change.

## Boundaries

Do not inspect unrelated files, repair unrelated diagnostics, rewrite prose,
or assume a package or resource exists when it was not supplied.

## Insufficient Evidence

When the diagnostic and source window do not identify a unique safe repair,
state what additional source or log context is required.
