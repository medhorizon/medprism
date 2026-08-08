# Skills

Agent Skills packages for MedPrism (Plan6 / Plan8).

Each skill is a folder with `SKILL.md` plus optional `scripts/`.

Wired at runtime via `src/lib/assistantRuntime.ts` + `src/tools/`:

| Skill | Tools used |
|---|---|
| `literature-cite` | `paper_search` (Europe PMC → deterministic BibTeX) |
| `fix-compile-errors` | `compile`, `parse_compile_log` |
| `section-revise` | none (prompt-only) |
