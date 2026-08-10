# MedPrism Skills — Plan07 runtime map

Skills are focused model instructions. They are **not** business workflows and do not decide tool order, file writes, or validation.

## Deterministic workflows

| Workflow | Primary Skill per model call | Runtime-owned steps |
|---|---|---|
| `writing` | `scientific-writing`, `academic-paper`, or explicit `nature-writing` | context, scope, hash/revision, Patch validation |
| `polish` | `nature-polishing` | exact selection and Patch validation |
| `latex` | `latex-paper-en` | allowed paths and compile-verification flag |
| `citation` | `nature-citation` | search, trusted metadata, cite key, BibTeX, atomic `.bib + \cite{}` Patch |
| `compile-fix` | `fix-compile-errors` | compile, root error, source window, path binding, one recompile |
| `review` | `academic-paper-reviewer` | coverage manifest; no file modification |

Every model call loads:

```text
Base Policy
+ one Workflow Instruction
+ at most one primary Skill
+ scoped context/tool data
```

A combined request such as “润色并补引用” remains one deterministic citation workflow with two explicit model steps. Each step still loads only one Skill.

## Runtime source of truth

- Router: `src/lib/skillRouter.ts`
- Workflow table: `src/lib/workflows/executor.ts`
- Workflow handlers: `src/lib/workflows/*.ts`
- Contract: [`_medprism-contract.md`](./_medprism-contract.md)

## Deprecated adapters

`section-revise` and `literature-cite` are retained only as migration/source material. They are not registered or loaded by the Plan07 runtime. Citation and compile-fix no longer inject `latex-paper-en` as a second Skill.

## Source layout

| Layer | Path |
|---|---|
| Upstream source copies | `.agents/skills/*` |
| MedPrism runtime adaptations | `skills/*` |
