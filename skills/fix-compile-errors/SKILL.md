---
name: fix-compile-errors
description: Diagnose one supplied LaTeX root error and propose one minimal source replacement.
---

# Fix compile errors

## Responsibility

1. Use only the supplied root diagnostic and nearby source window.
2. Propose exactly one minimal `replace_text` operation for the diagnosed file.
3. Copy `oldText` exactly from the source window.
4. Preserve scientific prose unless the compilation error directly requires a change.

## Forbidden

- Do not inspect or rewrite unrelated files.
- Do not repair secondary warnings in the same response.
- Do not output hashes, revisions, a complete PatchSet, or suggestion fences.
- Do not append text to the file end.

The runtime validates the proposal, binds it to the diagnosed path, and compiles once after the user Keeps it.
