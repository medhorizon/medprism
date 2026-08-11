# MedPrism Skill Compatibility Audit

Audit date: 2026-08-11

This is an audit-only document. No runtime-loaded skill is enabled or changed
by this audit. The staged adapters are documented separately and the two
deprecated migration files are explicitly marked non-runtime.
The runtime-loaded skill source is `skills/*`; `.agents/skills/*` is an upstream
source copy and must not be loaded by the MedPrism runtime.

## Contract baseline

Every model call must return exactly one JSON object for the active workflow:

```json
{
  "schemaVersion": "1",
  "workflow": "writing|polish|latex|citation|compile-fix|review|research",
  "summary": "short non-empty summary",
  "warnings": [],
  "content": "optional user-facing explanation"
}
```

The workflow-specific payload is the only additional payload: a runtime-located
writing/polish target uses `textDraft`; an unlocated writing/polish edit and
`latex`/`compile-fix` use `patchProposal`; `citation` uses `citationPlan`, and
`review` uses `review`. Research and advice are answer-only. The model owns
prose, explanations, and judgements. Runtime code owns active-file binding, exact selections,
paths, hashes, revisions, IDs, cite keys, verified bibliography records,
compilation state, and the hydrated typed `PatchSet`.

For a model `patchProposal`, operations are limited to `replace_text`,
`insert_before`, and `insert_after`. A replacement must copy `oldText`
verbatim from the supplied context; a selection request must use the exact
selected text. The model must not return `patch`, `patchSet`, `baseSha256`,
`projectRevision`, `range`, `expectedOccurrences`, `verify`, `bib_add`, or
whole-file content. If a safe target is unavailable, omit the proposal.

Review is read-only and advisory. It returns findings and limitations only;
applying a finding starts a separate writing workflow. Citation judgement may
refer only to candidate IDs from trusted search results and may not emit DOI,
PMID, title, authors, cite keys, BibTeX, or file edits.

## Runtime-loaded skills (`skills/*`)

| Skill | Status | Findings and required changes before enablement |
|---|---|---|
| `academic-paper` | Conditional | Correctly limits itself to supplied scope and forbids generated metadata/PatchSet. It does not state the complete `writing` envelope or the exact proposal operation shape. Add an explicit JSON example and state that runtime-located targets require `textDraft` (not an invented path), while local source edits use one minimal proposal. Keep literature search, formatting, compilation, and citation serialization out of this skill. |
| `scientific-writing` | Conditional | Correctly preserves evidence strength and delegates citation/LaTeX work. Its output section is prose-oriented and does not require `schemaVersion`, `workflow`, `summary`, `warnings`, or omission of unsafe proposals. Add the `writing` envelope and active-file/selection rules. Remove any implication that the model writes figures or files; those are runtime/tool stages. |
| `nature-writing` | Conditional | Correct venue gating and no fabricated evidence. Add the exact `writing` envelope, `textDraft` versus `patchProposal` rule, verbatim `oldText` requirement, and a strict prohibition on submission-package file creation. Do not carry over the upstream multi-file templates as model-owned writes. |
| `nature-polishing` | Conditional | Scope and claim-strength guardrails are good. Add the exact `polish` envelope and require the selected text verbatim as `oldText`; no path, range, hash, revision, or compile flag may be model supplied. Limit a normal polish response to one minimal replacement proposal. |
| `latex-paper-en` | Conditional | Good separation from scientific rewriting and citation generation. A project-structure change is broader than the runtime target contract; constrain proposals to supplied active files and runtime-resolved insert targets. Add the exact `latex` envelope and state that diagnostics are advisory until runtime compilation verification succeeds. |
| `fix-compile-errors` | Conditional | Correct one-root-error/one-operation boundary and no EOF append. Add the exact `compile-fix` envelope, require `patchProposal.operations` to contain exactly one `replace_text`, and explicitly omit it when the source window cannot prove a unique target. |
| `nature-citation` | Conditional | Correctly treats search and metadata as trusted runtime work. Its output contract is underspecified. Require `citationPlan.candidates[]` with only `{candidateId, relation, selected, reason}`, where relation is `supports|contradicts|related|topic_match_only`; candidate IDs must be copied from trusted results. Runtime binds claim/path and creates the atomic `.tex + .bib` PatchSet. |
| `academic-paper-reviewer` | Conditional | Correctly says read-only and no PatchSet. It lacks the runtime `review` payload schema and currently describes editorial decisions (`Accept/Minor/Major/Reject`) that are not fields in `ReviewReport`. Keep decisions in `content` or warnings; require each finding's severity, category, issue, whyItMatters, recommendation, and boolean `canApplyAsEdit`. Locations may reference only supplied files. Include limitations; runtime supplies the coverage manifest. |
| `literature-cite` | **Do not enable** | Deprecated adapter still instructs the model to output `suggestion` fences, choose/generate BibTeX, and insert cite keys. All three violate the runtime contract. Keep it migration-only and prevent imports/registration. Use `nature-citation` plus the runtime citation workflow. |
| `section-revise` | **Do not enable** | Deprecated alias has no JSON contract and says routing is stale. Keep it out of router imports and document it as migration-only. Use `nature-polishing` or `writing`. |

`skills/_medprism-contract.md` and `skills/README.md` correctly identify the
runtime as source of truth. Before enablement, add the envelope and exact
selection rules above to the contract document so a skill cannot be considered
compatible merely because it says "return the active workflow envelope".

## Upstream source copies (`.agents/skills/*`)

These files are not compatible as direct runtime prompts and should remain
quarantined behind the adapters in `skills/*`:

- `scientific-writing` declares `Read, Write, Edit, Bash` and describes saving
  generated figures; this permits model-owned file writes and bypasses typed
  PatchSet validation.
- `nature-writing` and `nature-polishing` use Markdown/plain-prose output
  formats and revision loops, not the MedPrism JSON envelope or selection-bound
  proposal contract.
- `nature-citation` runs an online search/export script and writes RIS/ENW/RDF;
  search, metadata verification, serialization, and atomic patching are
  runtime-owned in MedPrism.
- `academic-paper` exposes many agent phases, full-document/format conversion
  outputs, and generated figures. Those broad writes and artifacts must be
  reduced to one runtime workflow step before reuse.
- `latex-paper-en` and its scripts are useful diagnostics, but the upstream
  instruction set permits direct Bash/`uv` execution and comment-style output;
  only a runtime wrapper may invoke them and convert results to the envelope.
- `academic-paper-reviewer` has a strong read-only rule, but its large
  multi-reviewer output needs the compact `review` payload and runtime coverage
  fields. It must never emit a PatchSet or apply findings itself.

## Recommended enablement sequence (future work)

1. Make the `skills/*` adapters the only registered source and add a static
   contract lint that checks every registered skill for its workflow name,
   envelope example, scope rule, and forbidden runtime-owned fields.
2. Add fixture tests for strict parsing: wrong workflow, missing warnings,
   generated hashes/IDs, non-verbatim selection `oldText`, untrusted citation
   IDs, review findings pointing to unread files, and any suggestion fence.
3. Add one end-to-end fixture per write workflow to verify runtime hydration,
   stale revision rejection, atomic multi-file citation apply, and compile-fix
   verification. Keep review and research fixtures assertively file-write-free.
4. Only after these checks pass, consider enabling additional upstream content
   by copying its scientific guidance into a contract-compliant adapter; do not
   load `.agents/skills` directly.

## Conclusion

The current `skills/*` set is a promising adapter layer, but it is not yet a
complete contract specification: five writing/format skills and the citation
and review skills rely on the workflow prompt for essential schema details.
`literature-cite` and `section-revise` are unsafe if registered and are now
explicitly marked migration-only. The optimized adapters under
`skills/staged/*` remain disabled, so runtime behavior remains unchanged by
the staged work.
