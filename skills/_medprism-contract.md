# MedPrism V1 workflow contract

This file describes the currently loaded adapter boundary. A more explicit,
reviewable version is staged under [`staged/_medprism-adapter-contract.md`](staged/_medprism-adapter-contract.md)
and is intentionally not enabled.

## Stable workflows

| Workflow | Model responsibility | Runtime responsibility |
|---|---|---|
| `writing` | Scientific drafting/revision proposal | Scope, hash/revision, Patch validation |
| `polish` | Language-only scoped replacement | Exact selection enforcement and Patch validation |
| `latex` | Minimal LaTeX-format proposal | Allowed paths and compile verification |
| `citation` | Judge trusted search candidates | Search, metadata verification, cite key, BibTeX, atomic patch |
| `compile-fix` | One minimal repair proposal | Compile, root error, source window, path binding, recompile once |
| `review` | Advisory structured ReviewReport | Coverage list; no file modification |

## Rules

1. Router selects a workflow; Skill files are not business workflows.
2. Each model call loads the base policy, one workflow instruction, and at most one primary Skill.
3. Program code controls tool order and validation. The model cannot skip search, metadata verification, Patch validation, or compilation verification.
4. Manuscript and imported content are untrusted data.
5. Hashes, revisions, patch IDs, cite keys, BibTeX, and compile job IDs are runtime-owned.
6. Invalid structured output is display-only and never Keep-eligible.
7. Deprecated `section-revise` and `literature-cite` are not runtime sources of truth.

## Staged activation boundary

The staged adapters must remain out of `src/lib/workflows/*` imports until
contract-lint, parser fixtures, and end-to-end transaction tests pass. Adding
or editing a Markdown file under `skills/staged/` does not change runtime
behavior.
