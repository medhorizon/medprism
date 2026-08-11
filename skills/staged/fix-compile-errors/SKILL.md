---
name: fix-compile-errors
description: Repair one supplied root LaTeX compilation error with one minimal source replacement.
adapterStatus: staged
---

# Compile-fix (MedPrism staged adapter)

## Use when

Use only when the runtime supplies one root compiler diagnostic, its diagnosed
file, and a nearby source window. Warnings and unrelated errors are out of
scope.

## Behavior and scope

- Propose exactly one minimal `replace_text` operation in the diagnosed file.
- Copy `oldText` verbatim from the supplied source window and keep the fix
  local to the reported root cause.
- Preserve scientific prose, results, citations, labels, and equations unless
  the syntax error directly requires a change.
- If the source window does not prove a unique safe replacement, explain the
  limitation and omit the proposal. Never append text after
  `\\end{document}`.

## Output

Return the active `compile-fix` envelope with exactly one `patchProposal`:

```json
{"patchProposal":{"schemaVersion":"1","summary":"fix root error","operations":[{"op":"replace_text","oldText":"exact source","newText":"minimal fix"}]}}
```

Do not return `verify`, paths, ranges, hashes, revisions, a hydrated PatchSet,
or suggestion fences. The runtime binds the diagnosed path, attaches trusted
metadata, requires compile verification, and recompiles once after Keep.
