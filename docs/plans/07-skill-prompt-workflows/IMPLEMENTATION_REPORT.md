# Plan07 Implementation Report

> Source snapshot: `cursor/auth-registration-quota-200` at `03dd0a4bc4e977f19e9b7c58c5ef845ec9868929`
> Scope: lightweight deterministic Workflow Orchestration
> Status: implementation complete; official npm/GitHub CI verification pending

## 1. Previous state

The branch already contained reliable P01–P06 foundations: Typed Patch, active-file/selection snapshots, Electron compilation, citation Patch generation, and compile-error parsing. However, the assistant entry point still treated `SkillIntent` as the business flow and mixed routing, Skill selection, tool execution, prompt construction, model calls, and result adaptation inside `assistantRuntime.ts`.

Citation and compile-fix had partial workflow helpers, but there was no common `WorkflowRequest`, fixed handler table, unified typed result, or final workflow-level validation gate. Prompt and Skill responsibilities also still described the old multi-Skill pipeline in several files.

## 2. Implemented architecture

```text
UI action / user text
  → deterministic routeWorkflow()
  → WorkflowRequest
  → fixed Workflow Executor
  → one workflow handler
  → Base Policy + one Workflow Prompt + one primary Skill
  → strict model envelope parser
  → runtime-owned validation/hydration
  → AgentResult
  → Diff / Keep / ReviewReport
```

The executor is a fixed V1 table, not a dynamic planner, DAG, or Agent framework.

## 3. Workflows

### Writing / Polish / LaTeX

- Build an immutable ContextSnapshot.
- Select exactly one writing-domain, polish, Nature-writing, or LaTeX Skill.
- Parse only a model `patchProposal`.
- Runtime code attaches path, hash, revision, ID, selection range, and compile policy.
- Validate the resulting PatchSet before it reaches the UI.

### Citation

- Require an exact selected claim.
- Programmatically run `paper_search` before any model call.
- Load only `nature-citation` for candidate judgement.
- Reject unknown candidate IDs and model-generated DOI/PMID/BibTeX/cite keys.
- Runtime code normalizes trusted metadata and creates one atomic `.bib + \cite{}` PatchSet.
- A combined “polish + cite” request is two explicit steps; each call still loads one Skill.

### Compile-Fix

- Programmatically compile first.
- Extract one root diagnostic and exact source window.
- Load only `fix-compile-errors`.
- Require one minimal replacement bound to the diagnosed file.
- Runtime code requires one compilation verification after Keep.

### Review

- Collect bounded `.tex/.bib` context and runtime-owned coverage.
- Load only `academic-paper-reviewer`.
- Parse a typed ReviewReport.
- Reject every patch or citation payload. Applying a finding remains a later writing workflow.

## 4. Prompt and trust boundaries

The prompt stack is now:

```text
Base Policy
+ active Workflow Instruction
+ one selected Skill
+ scoped data
```

Manuscript and tool data use separate tagged blocks. Dynamic content is JSON-serialized with `<`, `>`, and `&` escaped so imported text cannot terminate the textual trust-boundary tags.

## 5. Runtime-owned metadata

The model can no longer choose or copy:

- file hash or project revision;
- Patch ID or exact range;
- compilation-verification policy;
- DOI/PMID, cite key, or serialized BibTeX;
- compile job ID.

Model proposals containing these fields are rejected rather than silently accepted.

## 6. Compatibility retained

- `SkillIntent`, `detectSkillIntent`, and `skillIdsForIntent` remain as compatibility APIs.
- `assistantRuntime` accepts the deprecated explicit `intent` field while new callers use `workflow`.
- Legacy suggestion fences and model-supplied complete PatchSets remain display-only.
- No authentication, localStorage, filesystem, or Electron architecture was migrated.

## 7. Deprecated runtime behavior

- Citation no longer injects `nature-citation + latex-paper-en` into one model call.
- Compile-fix no longer injects `fix-compile-errors + latex-paper-en` into one call.
- `section-revise` and `literature-cite` are retained only as source/migration material and are not imported by runtime code.
- Route/debug metadata stays in `toolNotes`; it is not appended to the user-facing response.

## 8. Tests added or expanded

Coverage includes:

- requested Chinese/English route fixtures;
- explicit UI and slash-command priority;
- Nature-review and cell-biology ambiguity;
- invalid JSON, wrong workflow, multiple payloads, full PatchSet attempts, and runtime-owned metadata attempts;
- writing Patch validation and no direct file mutation;
- search-before-model citation ordering;
- unknown/generated citation metadata rejection;
- combined polish+citation with one Skill per model step;
- compile-fix path binding;
- advisory review with runtime coverage and no Patch;
- prompt-boundary escaping.

The offline validation harness executed all repository test files and reported `64/64` passing. Strict production Workflow TypeScript and a full source static check with local external-module shims also passed.

## 9. Verification limitation

The execution environment could not resolve the npm registry, so the repository's real `npm ci`, Vitest binary, Vite build, and oxlint binary could not be installed. Therefore the official completion gate remains GitHub CI:

```text
npm ci
npm test
npm run typecheck
npm run build
npm run lint
```

The workflow `.github/workflows/plan07-verify.yml` runs that gate on `cursor/**` pushes, pull requests, and manual dispatch.

## 10. Known product limitations

- Review findings are displayed as a textual structured report; a dedicated per-finding Apply UI is not yet implemented.
- The rule router intentionally supports a small set of real combinations rather than arbitrary multi-intent planning.
- Literature retrieval still uses the existing Europe PMC connector.
- Model providers still use non-streaming Chat Completions.
