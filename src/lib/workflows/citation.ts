import natureCitationSkill from "../../../skills/nature-citation/SKILL.md?raw";
import naturePolishingSkill from "../../../skills/nature-polishing/SKILL.md?raw";
import { buildContextSnapshot, formatWorkspaceContext, type ContextSnapshot } from "../context/snapshot";
import { sha256Hex } from "../patch/hash";
import { assertSafeProjectRelativePath } from "../projectPath";
import { taggedPromptData } from "../promptData";
import type { ModelPatchProposal, PatchSet, PatchValidationError, StructuredBibEntry } from "../patch/schema";
import { parseModelWorkflowEnvelope } from "../replyParse";
import type { PaperHit } from "../../tools/types";
import {
  allocateCiteKey,
  existingCiteKeyForHit,
  indexBibliography,
  normalizeDoi,
  normalizeTitle,
  paperHitToStructuredBibEntry,
} from "../../tools/bibtex";
import { finalizePatchSet } from "./latexApply";
import { buildWorkflowSystemPrompt } from "./prompt";
import { validateProtectedTextReplacement } from "./textSafety";
import { compactPaperHits } from "../research/service";
import {
  emptyAgentResult,
  type CitationJudgement,
  type CitationPlan,
  type CitationRelation,
  type WorkflowHandler,
  type WorkflowResult,
} from "./types";

export type { CitationJudgement, CitationPlan, CitationRelation } from "./types";

export type CitationWorkflowResult =
  | { ok: true; plan: CitationPlan; patchSet?: PatchSet }
  | { ok: false; error: PatchValidationError };

const RELATIONS = new Set<CitationRelation>([
  "supports",
  "contradicts",
  "related",
  "topic_match_only",
]);

export function parseCitationJudgements(
  value: unknown,
  hits: PaperHit[],
):
  | { ok: true; judgements: CitationJudgement[] }
  | { ok: false; error: PatchValidationError } {
  if (!value || typeof value !== "object") {
    return { ok: false, error: { code: "INVALID_PATCH", message: "Citation judgement must be an object" } };
  }
  const rows = (value as { candidates?: unknown }).candidates;
  if (!Array.isArray(rows)) {
    return { ok: false, error: { code: "INVALID_PATCH", message: "Citation candidates must be an array" } };
  }
  const byId = new Map(hits.map((hit) => [hit.id, hit]));
  const seen = new Set<string>();
  const judgements: CitationJudgement[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: { code: "INVALID_PATCH", message: "Invalid citation judgement" } };
    }
    const candidate = raw as Record<string, unknown>;
    const forbiddenMetadata = ["doi", "pmid", "citeKey", "bibtex", "title", "authors"].find(
      (field) => candidate[field] !== undefined,
    );
    if (forbiddenMetadata) {
      return {
        ok: false,
        error: {
          code: "INVALID_PATCH",
          message: `Citation judgement must not generate ${forbiddenMetadata}; use trusted tool metadata`,
        },
      };
    }
    const candidateId = String(candidate.candidateId ?? "");
    const relation = candidate.relation as CitationRelation;
    const hit = byId.get(candidateId);
    if (!hit || seen.has(candidateId) || !RELATIONS.has(relation)) {
      return {
        ok: false,
        error: { code: "INVALID_PATCH", message: `Untrusted or invalid citation candidate: ${candidateId}` },
      };
    }
    if (candidate.selected !== true && candidate.selected !== false) {
      return { ok: false, error: { code: "INVALID_PATCH", message: "selected must be boolean" } };
    }
    if (relation === "supports" && !hit.abstract) {
      return {
        ok: false,
        error: {
          code: "INVALID_PATCH",
          message: `Title-only candidate ${candidateId} cannot be classified as supports`,
        },
      };
    }
    seen.add(candidateId);
    judgements.push({
      candidateId,
      relation,
      selected: candidate.selected,
      reason: typeof candidate.reason === "string" ? candidate.reason : "",
    });
  }
  return { ok: true, judgements };
}

function insertCitationBeforeTrailingPunctuation(claim: string, citation: string): string {
  const match = claim.match(/([\s]*[.,;:!?])([\s]*)$/u);
  if (!match || match.index === undefined) return `${claim}${citation}`;
  return `${claim.slice(0, match.index)}${citation}${claim.slice(match.index)}`;
}

function bibliographyPath(value: string): string {
  const trimmed = value.trim();
  const withExtension = trimmed.toLowerCase().endsWith(".bib") ? trimmed : `${trimmed}.bib`;
  return assertSafeProjectRelativePath(withExtension);
}

export function discoverBibliographyPaths(files: Readonly<Record<string, string>>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    try {
      const path = bibliographyPath(raw);
      if (!seen.has(path)) {
        seen.add(path);
        found.push(path);
      }
    } catch {
      // Unsafe or macro-based resources are not eligible for automatic writes.
    }
  };

  for (const [path, source] of Object.entries(files)) {
    if (!path.toLowerCase().endsWith(".tex")) continue;
    for (const match of source.matchAll(/\\addbibresource(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/gi)) {
      add(match[1] ?? "");
    }
    for (const match of source.matchAll(/\\bibliography\s*\{([^}]+)\}/gi)) {
      for (const entry of (match[1] ?? "").split(",")) add(entry);
    }
  }
  return found;
}

function resolveBibliographyPath(
  snapshot: ContextSnapshot,
  requested?: string,
): { ok: true; path: string } | { ok: false; error: PatchValidationError } {
  const declared = discoverBibliographyPaths(snapshot.files);
  if (declared.length === 0) {
    return {
      ok: false,
      error: {
        code: "BIBLIOGRAPHY_NOT_CONFIGURED",
        message:
          "No safe \\addbibresource{...} or \\bibliography{...} declaration was found. Configure the bibliography before inserting citations.",
      },
    };
  }

  if (requested) {
    let normalized: string;
    try {
      normalized = bibliographyPath(requested);
    } catch (error) {
      return {
        ok: false,
        error: {
          code: "UNSAFE_PATH",
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    if (!declared.includes(normalized)) {
      return {
        ok: false,
        error: {
          code: "BIBLIOGRAPHY_NOT_CONFIGURED",
          message: `Bibliography ${normalized} is not declared by the LaTeX project`,
          path: normalized,
        },
      };
    }
    return { ok: true, path: normalized };
  }

  if (declared.length === 1) return { ok: true, path: declared[0]! };
  const existing = declared.filter((path) => snapshot.files[path] !== undefined);
  if (existing.length === 1) return { ok: true, path: existing[0]! };
  return {
    ok: false,
    error: {
      code: "BIBLIOGRAPHY_NOT_CONFIGURED",
      message: `Multiple bibliography resources are declared (${declared.join(", ")}); choose a target explicitly before inserting citations.`,
    },
  };
}

export async function buildCitationPatch(args: {
  snapshot: ContextSnapshot;
  hits: PaperHit[];
  judgements: CitationJudgement[];
  bibliographyPath?: string;
  replacementClaim?: string;
}): Promise<CitationWorkflowResult> {
  const { snapshot, hits, judgements } = args;
  const claim = snapshot.selectedText;
  if (!claim || !snapshot.selection) {
    return {
      ok: false,
      error: { code: "RANGE_MISMATCH", message: "Citation workflow requires an exact text selection" },
    };
  }
  const byId = new Map(hits.map((hit) => [hit.id, hit]));
  const selected = judgements.filter(
    (item) => item.selected && item.relation === "supports",
  );
  const replacementClaim = args.replacementClaim?.trim() || claim;
  if (selected.length === 0) {
    const warnings = ["No supplied candidate was selected as adequate evidence."];
    const plan: CitationPlan = {
      schemaVersion: "1",
      claim,
      targetPath: snapshot.activeFile,
      candidates: judgements,
      warnings,
    };
    if (replacementClaim === claim) return { ok: true, plan };
    const patchSet: PatchSet = {
      schemaVersion: "1",
      id: crypto.randomUUID(),
      projectRevision: snapshot.projectRevision,
      summary: "Polish selected claim without adding an unverified citation",
      operations: [{
        op: "replace_text",
        path: snapshot.activeFile,
        baseSha256: snapshot.activeFileSha256,
        oldText: claim,
        newText: replacementClaim,
        expectedOccurrences: 1,
        range: snapshot.selection,
      }],
      verify: { compile: false },
    };
    return { ok: true, plan, patchSet };
  }

  const resolvedBibliography = resolveBibliographyPath(snapshot, args.bibliographyPath);
  if (!resolvedBibliography.ok) return { ok: false, error: resolvedBibliography.error };
  const bibliographyPath = resolvedBibliography.path;
  const existingBib = snapshot.files[bibliographyPath] ?? "";
  const bibliographyIndex = indexBibliography(existingBib);
  const occupied = new Set(bibliographyIndex.keys);
  const entries: StructuredBibEntry[] = [];
  const citationKeys: string[] = [];
  const allocatedByIdentity = new Map<string, string>();
  for (const judgement of selected) {
    const hit = byId.get(judgement.candidateId);
    if (!hit) {
      return {
        ok: false,
        error: {
          code: "INVALID_PATCH",
          message: `Citation candidate is not present in trusted search results: ${judgement.candidateId}`,
        },
      };
    }
    const existingKey = existingCiteKeyForHit(hit, bibliographyIndex);
    if (existingKey) {
      citationKeys.push(existingKey);
      continue;
    }
    const identity = normalizeDoi(hit.doi)
      ? `doi:${normalizeDoi(hit.doi)}`
      : hit.pmid?.trim()
        ? `pmid:${hit.pmid.trim()}`
        : `title:${normalizeTitle(hit.title)}`;
    const allocatedKey = allocatedByIdentity.get(identity);
    if (allocatedKey) {
      citationKeys.push(allocatedKey);
      continue;
    }
    const key = allocateCiteKey(hit, occupied);
    allocatedByIdentity.set(identity, key);
    entries.push(paperHitToStructuredBibEntry(hit, key));
    citationKeys.push(key);
  }

  const alreadyCited = new Set(
    [...claim.matchAll(/\\cite\w*\s*\{([^}]+)\}/g)]
      .flatMap((match) => match[1]!.split(","))
      .map((key) => key.trim().toLowerCase())
      .filter(Boolean),
  );
  const keysToInsert = [...new Set(citationKeys)].filter(
    (key) => !alreadyCited.has(key.toLowerCase()),
  );

  const warnings: string[] = [];
  const relatedSelected = judgements.filter((item) => item.selected && item.relation === "related");
  if (relatedSelected.length) {
    warnings.push("Related-only candidates were not inserted as support for the selected claim.");
  }
  if (!keysToInsert.length) {
    warnings.push(
      entries.length
        ? "The citation command already exists; only missing bibliography entries will be added."
        : "All selected supporting references are already cited in the selection.",
    );
  }

  const operations: PatchSet["operations"] = [];
  if (entries.length) {
    operations.push({
      op: "bib_add",
      path: bibliographyPath,
      entries,
      ...(snapshot.files[bibliographyPath] === undefined
        ? { mustNotExist: true as const }
        : { baseSha256: await sha256Hex(existingBib) }),
    });
  }
  if (keysToInsert.length || replacementClaim !== claim) {
    const newClaim = keysToInsert.length
      ? insertCitationBeforeTrailingPunctuation(
          replacementClaim,
          `\\cite{${keysToInsert.join(",")}}`,
        )
      : replacementClaim;
    operations.push({
      op: "replace_text",
      path: snapshot.activeFile,
      baseSha256: snapshot.activeFileSha256,
      oldText: claim,
      newText: newClaim,
      expectedOccurrences: 1,
      range: snapshot.selection,
    });
  }
  const plan: CitationPlan = {
    schemaVersion: "1",
    claim,
    targetPath: snapshot.activeFile,
    candidates: judgements,
    warnings,
  };
  if (operations.length === 0) return { ok: true, plan };

  return {
    ok: true,
    plan,
    patchSet: {
      schemaVersion: "1",
      id: crypto.randomUUID(),
      projectRevision: snapshot.projectRevision,
      summary: `Ground claim with ${citationKeys.length} verified reference${citationKeys.length === 1 ? "" : "s"}`,
      operations,
      verify: { compile: true },
    },
  };
}

export function citationJudgementPrompt(snapshot: ContextSnapshot, hits: PaperHit[]): string {
  return [
    formatWorkspaceContext(snapshot),
    taggedPromptData(
      "trusted_tool_results",
      'source="paper_search"',
      { candidates: compactPaperHits(hits) },
    ),
    taggedPromptData(
      "user_request",
      "",
      { text: "Evaluate citations for the selected claim only." },
    ),
  ].join("\n\n");
}

function invalidCitationResult(message: string, content = ""): WorkflowResult {
  return {
    agent: emptyAgentResult("citation", "Citation workflow did not produce an applicable result", [message]),
    content: content || message,
    toolNotes: [],
  };
}

/** Runtime guard for a combined “polish + cite” request. */
export function validateCitationProseRevision(
  original: string,
  replacement: string,
): { ok: true } | { ok: false; message: string } {
  return validateProtectedTextReplacement(original, replacement);
}

function scopedRevisionProposal(
  proposal: ModelPatchProposal | undefined,
  snapshot: ContextSnapshot,
): { ok: true; replacementClaim?: string } | { ok: false; message: string } {
  if (!proposal) return { ok: true };
  if (proposal.operations.length !== 1 || proposal.operations[0]?.op !== "replace_text") {
    return { ok: false, message: "Citation prose revision must contain exactly one replace_text operation" };
  }
  const operation = proposal.operations[0];
  if (operation.path !== undefined && operation.path !== snapshot.activeFile) {
    return { ok: false, message: "Citation prose revision may only edit the selected active file" };
  }
  if (operation.oldText !== snapshot.selectedText) {
    return { ok: false, message: "Citation prose revision must replace the exact selected text" };
  }
  const protectedResult = validateCitationProseRevision(
    snapshot.selectedText ?? "",
    operation.newText,
  );
  if (!protectedResult.ok) return protectedResult;
  return { ok: true, replacementClaim: operation.newText };
}

async function optionalProseRevision(
  input: Parameters<WorkflowHandler>[0],
  snapshot: ContextSnapshot,
  hits: PaperHit[],
): Promise<{ replacementClaim?: string; warning?: string }> {
  if (!input.request.reviseProse) return {};
  const raw = await input.services.complete({
    config: input.config,
    messages: [
      {
        role: "system",
        content: buildWorkflowSystemPrompt({
          workflow: "polish",
          skillId: "nature-polishing",
          skill: naturePolishingSkill,
          capabilities: ["research", "latex-output"],
        }),
      },
      { role: "user", content: formatWorkspaceContext(snapshot) },
      {
        role: "user",
        content: taggedPromptData(
          "trusted_tool_results",
          'source="research"',
          { candidates: compactPaperHits(hits) },
        ),
      },
      {
        role: "user",
        content: [
          "<user_request>",
          "Polish the selected claim without adding, removing, or inventing citations.",
          "Return exactly one selection-scoped replace_text proposal.",
          "</user_request>",
        ].join("\n"),
      },
    ],
  });
  const parsed = parseModelWorkflowEnvelope(raw, "polish");
  if (!parsed.ok) return { warning: `Prose revision skipped: ${parsed.error.message}` };
  const scoped = scopedRevisionProposal(parsed.envelope.proposal, snapshot);
  if (!scoped.ok) return { warning: `Prose revision skipped: ${scoped.message}` };
  return scoped.replacementClaim === undefined
    ? {}
    : { replacementClaim: scoped.replacementClaim };
}

export const runCitationWorkflow: WorkflowHandler = async (input) => {
  let snapshot: ContextSnapshot;
  try {
    snapshot = await buildContextSnapshot(input.ctx);
  } catch (error) {
    return invalidCitationResult(error instanceof Error ? error.message : String(error));
  }
  if (!snapshot.selectedText || !snapshot.selection) {
    return invalidCitationResult("请先选中需要补充引用的具体论断。");
  }

  const hits = input.research?.hits ?? [];
  if (!input.research) {
    return invalidCitationResult("Citation workflow requires the independent research stage.");
  }
  if (!hits.length) {
    return invalidCitationResult("未找到足够相关的文献，未生成引用。");
  }

  const raw = await input.services.complete({
    config: input.config,
    messages: [
      {
        role: "system",
        content: buildWorkflowSystemPrompt({
          workflow: "citation",
          skillId: "nature-citation",
          skill: natureCitationSkill,
          capabilities: ["research", "latex-output"],
        }),
      },
      { role: "user", content: citationJudgementPrompt(snapshot, hits) },
    ],
  });
  const parsed = parseModelWorkflowEnvelope(raw, "citation");
  if (!parsed.ok) return invalidCitationResult(parsed.error.message, parsed.rawContent);
  if (
    parsed.envelope.proposal ||
    parsed.envelope.textDraftValue !== undefined ||
    parsed.envelope.reviewValue !== undefined
  ) {
    return invalidCitationResult(
      "Citation judgement returned a file-edit payload instead of a CitationPlan",
      parsed.envelope.content,
    );
  }
  if (parsed.envelope.citationPlanValue === undefined) {
    return invalidCitationResult("Citation workflow did not return citationPlan", parsed.envelope.content);
  }
  const judged = parseCitationJudgements(parsed.envelope.citationPlanValue, hits);
  if (!judged.ok) return invalidCitationResult(judged.error.message, parsed.envelope.content);

  const revision = await optionalProseRevision(input, snapshot, hits);
  const built = await buildCitationPatch({
    snapshot,
    hits,
    judgements: judged.judgements,
    ...(revision.replacementClaim !== undefined
      ? { replacementClaim: revision.replacementClaim }
      : {}),
  });
  if (!built.ok) return invalidCitationResult(built.error.message, parsed.envelope.content);

  const workflowWarnings = [
    ...parsed.envelope.warnings,
    ...built.plan.warnings,
    ...input.research.warnings,
    ...(revision.warning ? [revision.warning] : []),
  ];
  let patch = built.patchSet;
  if (patch) {
    const finalized = await finalizePatchSet(snapshot, patch);
    if (!finalized.ok) {
      return invalidCitationResult(finalized.error.message, parsed.envelope.content);
    }
    patch = finalized.patchSet;
  }

  const selectedSupportCount = built.plan.candidates.filter(
    (candidate) => candidate.selected && candidate.relation === "supports",
  ).length;
  const content = parsed.envelope.content || (patch
    ? `已验证 ${selectedSupportCount} 条候选引用并生成可审阅补丁。`
    : workflowWarnings.join(" ") || "没有需要写入项目的引用变更。");

  return {
    agent: {
      schemaVersion: "1",
      workflow: "citation",
      summary: parsed.envelope.summary,
      warnings: workflowWarnings,
      citationPlan: built.plan,
      ...(patch ? { patch } : {}),
    },
    content,
    toolNotes: [`research-consumed:${hits.length}`, "skill:nature-citation"],
  };
};
