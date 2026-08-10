# Plan07.2 Implementation Report — Composable Research and LaTeX Application

> Baseline: Plan07.1 completed source derived from `cursor/auth-registration-quota-200@03dd0a4bc4e977f19e9b7c58c5ef845ec9868929`
> Scope: independent Research capability + deterministic workflow composition + universal LaTeX application
> Status: implementation complete; repository-native npm/GitHub CI verification pending

## 1. Why Plan07.2 was needed

Plan07.1 correctly introduced deterministic workflows, but research-assisted writing was initially implemented around one product example: “research a topic and write an Abstract”. That made the target-specific helper too important and did not express the real product model:

- Research may be used alone.
- Research may precede Writing, Polish, Citation, or Review.
- Abstract, Methods, Discussion, Funding, a custom section, the document body, and an exact selection are all ordinary LaTeX text targets.
- Every accepted text modification must pass through one trusted LaTeX/Patch finalization boundary.

Plan07.2 removes the Abstract-centered architecture without introducing a planner, DAG engine, or autonomous agent.

## 2. Implemented architecture

```text
UI action / user text
  → deterministic Router
  → linear WorkflowPlan
       ├─ optional independent Research stage
       ├─ exactly one primary workflow
       │    ├─ Research-only
       │    ├─ Writing
       │    ├─ Polish
       │    ├─ Citation
       │    ├─ LaTeX engineering
       │    ├─ Compile-fix
       │    └─ Review
       └─ optional trusted latex-apply stage
  → Patch validation
  → Diff / Keep / Undo
```

This remains a fixed product workflow. `WorkflowPlan.steps` is descriptive and runtime-owned; the language model cannot create or reorder stages.

## 3. Independent Research capability

`src/lib/research/service.ts` now owns:

- deterministic query resolution;
- the single `paper_search` call;
- trusted result parsing;
- result-size and abstract-evidence policy;
- reusable `ResearchBundle` creation;
- validation that downstream model output references only trusted candidate IDs.

Research never edits files. It can feed:

```text
research
research → writing
research → polish
research → citation
research → review
```

For example:

```text
调研 HCC
  → ResearchReport, no PatchSet

调研 HCC 后撰写 Methods
  → ResearchBundle → Writing → latex-apply

调研 HCC 后润色这段
  → ResearchBundle → Polish → latex-apply

调研 HCC 并给这句话补引用
  → ResearchBundle → Citation → atomic bibliography/text PatchSet
```

The research connector never receives the full natural-language instruction as an accidental fallback query. The router/runtime must provide an explicit topic or selected claim.

## 4. General LaTeX target model

The Abstract-specific target implementation was replaced by a general `LatexTargetSpec` and resolver. Supported targets include:

- exact selection;
- Abstract;
- title and keywords;
- Introduction, Methods, Results, Discussion, and Conclusion;
- Funding, Acknowledgements, Author Contributions, Data Availability, Ethics, and Conflict of Interest;
- document body;
- custom named sections such as `Limitations`.

Trusted runtime code owns:

- the target file;
- exact source range;
- section/environment wrapper;
- insertion anchor;
- file hash and project revision;
- PatchSet ID and compile-verification policy.

The model returns only target prose in `textDraft`. It never returns the heading, wrapper, path, range, hash, or whole file.

## 5. One LaTeX finalization gateway

`src/lib/workflows/latexApply.ts` is the single finalization boundary for file-changing workflows:

- generic Writing/Polish/LaTeX proposals;
- runtime-located target drafts;
- Citation bibliography + `\cite{}` patches;
- Compile-Fix patches.

Every accepted modification is hydrated and validated before the UI can show Keep. Research-only and Review are explicitly forbidden from returning PatchSets.

## 6. Prompt and Skill responsibilities

The prompt stack remains:

```text
Base Policy
+ one active Workflow instruction
+ optional capability instructions
+ one primary Skill
+ scoped manuscript/tool data
```

Capabilities are separate from workflows:

- `research.md`: consume trusted literature results and report candidate provenance;
- `latex-output.md`: explain that runtime code owns target application and Patch metadata.

`targeted-text.md` works for any runtime-located target. It tells the model to return `plain-text` for ordinary prose and `latex-body` whenever existing inline LaTeX, math, citations, references, labels, or commands must be preserved.

## 7. Safety invariants

- Research is run by TypeScript, not chosen or repeated by the model.
- Candidate identifiers must come from trusted search results.
- Writing cannot invent `\cite{}`, DOI, or PMID.
- Citation owns cite-key generation and BibTeX serialization.
- Polish preserves numbers, units, math, citations, references, labels, command names, and environment boundaries.
- Runtime-located text cannot escape its target range.
- Plain-text replacement is rejected when existing target content contains LaTeX structure that must be preserved.
- Compile-Fix remains bound to one diagnosed source file and requires compile verification.
- Review and standalone Research remain advisory and cannot produce Keep-eligible patches.

## 8. Compatibility and cleanup

- The former Abstract-specific `research-writing.md` prompt was removed.
- `abstractWriting.ts` remains only as a thin deprecated compatibility adapter over the general target-writing implementation.
- The legacy `writingDraft` parser alias is retained temporarily for older tests/callers; new model output uses `textDraft`.
- No authentication, localStorage, filesystem, Electron, or dependency architecture was changed.
- No LangChain, LangGraph, AutoGen, planner, DAG engine, or multi-agent framework was added.

## 9. Verification performed

Local independent checks reported:

```text
strict source TypeScript check             PASS
strict relevant-test TypeScript check      PASS
offline repository regression suite        106 / 106 PASS
composable runtime smoke                    PASS
git diff --check                            PASS
package-lock.json unchanged                 PASS
```

Coverage includes:

- research-only;
- research + Abstract/Methods/Discussion/Funding writing;
- research + Polish, including protected scientific/LaTeX content;
- research + Citation with one search and atomic `.bib + text` patch;
- generic and custom LaTeX targets;
- selection-scoped edits;
- invalid model payloads producing no Keep-eligible patch;
- Compile-Fix path binding;
- Review with no PatchSet;
- previous P01–P06 regressions.

## 10. Repository-native verification limitation

A repository-native `npm ci --ignore-scripts` attempt did not complete within the isolated environment and was terminated. Therefore the following official project commands still need to run in GitHub CI or a normal developer environment:

```text
npm ci
npm test
npm run typecheck
npm run build
npm run lint
```

The implementation remains marked CI-pending until those commands pass.

## 11. Known limitations

- Literature retrieval still uses the existing connector and one deterministic query per Research stage.
- The router intentionally supports fixed, understandable combinations rather than arbitrary intent graphs.
- A dedicated UI that visually displays the stage plan (`Research → Writing → LaTeX`) is not yet implemented.
- Review finding “Apply” remains a separate future Writing action.
- The deprecated Abstract compatibility adapter can be removed after all external callers migrate to `textDraft` and `LatexTargetSpec`.
