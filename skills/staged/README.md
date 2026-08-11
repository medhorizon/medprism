# Staged MedPrism skill adapters

This directory is a reviewable, opt-in replacement set for the runtime-loaded
adapters in `skills/*`. It is intentionally not imported by the application.
The current runtime continues to load the existing adapters until the
activation gates below pass.

## Product conventions carried into the adapters

- Start from the active selection or semantic target, then show a diff before
  any Keep action. This matches the low-friction interaction used by mature
  scientific writing tools: a short action, a bounded result, and an explicit
  accept/reject decision.
- Keep provenance and uncertainty visible. Search candidates, evidence
  relations, and review limitations are data supplied by the runtime, not
  facts to infer from a title or a vague memory.
- Use a calm, concise, evidence-aware voice. Match the user's language for
  explanations, avoid marketing language, and state what is missing instead of
  filling a gap with plausible prose.
- Keep generated prose body-only. The runtime owns LaTeX wrappers, paths,
  selections, hashes, revisions, PatchSet metadata, cite keys, BibTeX, and
  compilation.

## Future activation gates

1. Run a static contract lint over every staged `SKILL.md`.
2. Add parser fixtures for payload exclusivity, exact selection replacement,
   trusted candidate IDs, review coverage, and compile-fix single-operation
   behavior.
3. Run one end-to-end transaction fixture per write workflow, including stale
   revision rejection and atomic citation writes.
4. Switch imports in `src/lib/workflows/*` only after the previous gates pass.

See [`docs/skill-compatibility-audit.md`](../../docs/skill-compatibility-audit.md)
for the audit and the rationale for keeping upstream `.agents/skills` content
quarantined.
