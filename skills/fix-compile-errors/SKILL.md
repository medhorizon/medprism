---
name: fix-compile-errors
description: Diagnose LaTeX compile failures and apply minimal patches. Use when compile fails, Fix with AI is clicked, or the user mentions log warnings.
---

# Fix compile errors

## Workflow

1. Read structured errors from `parse_compile_log` (and raw log if provided).
2. Locate the responsible file/line in the project context.
3. Propose a **minimal** suggestion patch for that file only.
4. Do not rewrite unrelated sections.
5. After the user Keeps the patch, the workspace may recompile (tools mode, max 2 retries).

## Output

- Short diagnosis in chat.
- One `suggestion` fence with correct `path` matching a project file.
- Prefer fixing unmatched environments, missing braces, and typos called out by the log.
