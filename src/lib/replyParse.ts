import { softenRawPatchProposal } from "./patch/insertAnchor";
import {
  parseModelPatchProposal,
  parsePatchSet,
  type ModelPatchProposal,
  type PatchSet,
  type PatchValidationError,
  type PatchValidationErrorCode,
} from "./patch/schema";
import type { ChatSuggestion } from "../types/chat";
import type { WorkflowKind } from "./workflows/types";

export type ProposalEnvelope = {
  content: string;
  proposal?: ModelPatchProposal;
  patchSet?: PatchSet;
  error?: PatchValidationError;
};

export type ModelWorkflowEnvelope = {
  schemaVersion: "1";
  workflow: WorkflowKind;
  summary: string;
  warnings: string[];
  content: string;
  proposal?: ModelPatchProposal;
  textDraftValue?: unknown;
  /** Compatibility alias retained for Plan07.1 tests/callers. */
  writingDraftValue?: unknown;
  researchUseValue?: unknown;
  citationPlanValue?: unknown;
  researchReportValue?: unknown;
  reviewValue?: unknown;
};

export type ParseWorkflowEnvelopeResult =
  | { ok: true; envelope: ModelWorkflowEnvelope }
  | { ok: false; error: PatchValidationError; rawContent: string };

/** Best-effort cleanup for common model JSON quirks (esp. GPT trailing commas). */
export function repairJsonText(text: string): string {
  return text
    .replace(/^\uFEFF/, "")
    // Trailing commas before } or ]
    .replace(/,(\s*[}\]])/g, "$1")
    // // line comments
    .replace(/^\s*\/\/.*$/gm, "");
}

function tryParseJson(text: string): unknown {
  return JSON.parse(text);
}

export function extractJsonValue(raw: string): unknown {
  const fence = raw.match(/```json\s*([\s\S]*?)```/i) ?? raw.match(/```patch\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() ?? raw.trim();
  const attempts = [candidate];
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    attempts.push(candidate.slice(start, end + 1));
  }
  let lastError: unknown;
  for (const attempt of attempts) {
    for (const text of [attempt, repairJsonText(attempt)]) {
      try {
        return tryParseJson(text);
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Model response did not contain valid JSON");
}

function invalidWorkflowResult(
  message: string,
  raw: string,
  code: PatchValidationErrorCode = "INVALID_PATCH",
): ParseWorkflowEnvelopeResult {
  return {
    ok: false,
    error: { code, message },
    rawContent: raw.trim(),
  };
}

function stringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return [...value];
}

function hasPayload(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** Empty operations mean “no file edit”; treat as omitted patchProposal. */
function isEmptyPatchProposal(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const operations = (value as Record<string, unknown>).operations;
  return Array.isArray(operations) && operations.length === 0;
}

function effectivePatchProposal(value: unknown): unknown | undefined {
  if (!hasPayload(value) || isEmptyPatchProposal(value)) return undefined;
  return value;
}

/** Strict typed model-envelope parser. Runtime metadata never comes from the model. */
export function parseModelWorkflowEnvelope(
  raw: string,
  expectedWorkflow: WorkflowKind,
): ParseWorkflowEnvelopeResult {
  let value: unknown;
  try {
    value = extractJsonValue(raw);
  } catch (error) {
    return invalidWorkflowResult(
      error instanceof Error ? error.message : String(error),
      raw,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalidWorkflowResult("Workflow result must be a JSON object", raw);
  }

  const record = value as Record<string, unknown>;
  const schemaVersion =
    record.schemaVersion === 1 || record.schemaVersion === "1" ? "1" : record.schemaVersion;
  if (schemaVersion !== "1") {
    return invalidWorkflowResult('Workflow result schemaVersion must be "1"', raw);
  }
  record.schemaVersion = "1";
  if (record.workflow !== expectedWorkflow) {
    return invalidWorkflowResult(
      `Expected workflow ${expectedWorkflow}, received ${String(record.workflow ?? "<missing>")}`,
      raw,
      "WRONG_WORKFLOW",
    );
  }
  if (typeof record.summary !== "string" || !record.summary.trim()) {
    return invalidWorkflowResult("Workflow result summary is required", raw);
  }
  const warnings = stringArray(record.warnings);
  if (!warnings) {
    return invalidWorkflowResult("Workflow warnings must be an array of strings", raw);
  }
  if (record.patch !== undefined || record.patchSet !== undefined) {
    return invalidWorkflowResult(
      "The model must not return a hydrated patch or PatchSet; runtime metadata is trusted code only",
      raw,
      "RUNTIME_OWNED_FIELD",
    );
  }
  if (hasPayload(record.textDraft) && hasPayload(record.writingDraft)) {
    return invalidWorkflowResult("Use textDraft only; do not return both textDraft and legacy writingDraft", raw);
  }

  const textDraftValue = hasPayload(record.textDraft)
    ? record.textDraft
    : hasPayload(record.writingDraft)
      ? record.writingDraft
      : undefined;
  const patchProposalValue = effectivePatchProposal(record.patchProposal);
  const emptyPatchOmitted = hasPayload(record.patchProposal) && patchProposalValue === undefined;
  const payloadCount = [
    hasPayload(patchProposalValue),
    hasPayload(textDraftValue),
    hasPayload(record.citationPlan),
    hasPayload(record.researchReport),
    hasPayload(record.review),
  ].filter(Boolean).length;
  if (payloadCount > 1) {
    return invalidWorkflowResult("Workflow result must contain at most one typed payload", raw);
  }

  let proposal: ModelPatchProposal | undefined;
  if (hasPayload(patchProposalValue)) {
    const parsed = parseModelPatchProposal(softenRawPatchProposal(patchProposalValue), {
      summary: record.summary.trim(),
    });
    if (!parsed.ok) {
      return { ok: false, error: parsed.error, rawContent: raw.trim() };
    }
    proposal = parsed.proposal;
  }

  return {
    ok: true,
    envelope: {
      schemaVersion: "1",
      workflow: expectedWorkflow,
      summary: record.summary.trim(),
      warnings: emptyPatchOmitted
        ? [...warnings, "Model returned an empty patchProposal; treated as advice-only (no Keep)."]
        : warnings,
      content: typeof record.content === "string" ? record.content.trim() : "",
      ...(proposal ? { proposal } : {}),
      ...(hasPayload(textDraftValue)
        ? {
            textDraftValue,
            ...(hasPayload(record.writingDraft) ? { writingDraftValue: record.writingDraft } : {}),
          }
        : {}),
      ...(hasPayload(record.researchUse) ? { researchUseValue: record.researchUse } : {}),
      ...(hasPayload(record.citationPlan)
        ? { citationPlanValue: record.citationPlan }
        : {}),
      ...(hasPayload(record.researchReport)
        ? { researchReportValue: record.researchReport }
        : {}),
      ...(hasPayload(record.review) ? { reviewValue: record.review } : {}),
    },
  };
}

export function parseProposalEnvelope(raw: string): ProposalEnvelope {
  try {
    const parsed = extractJsonValue(raw);
    if (!parsed || typeof parsed !== "object") {
      return { content: raw.trim() };
    }
    const envelope = parsed as Record<string, unknown>;
    const content = typeof envelope.content === "string" ? envelope.content : "";

    const patchProposalValue = effectivePatchProposal(envelope.patchProposal);
    if (hasPayload(patchProposalValue)) {
      const proposal = parseModelPatchProposal(softenRawPatchProposal(patchProposalValue), {
        summary: typeof envelope.summary === "string" ? envelope.summary.trim() : "",
      });
      if (!proposal.ok) return { content, error: proposal.error };
      return { content, proposal: proposal.proposal };
    }
    if (hasPayload(envelope.patchSet)) {
      const patch = parsePatchSet(envelope.patchSet);
      if (!patch.ok) return { content, error: patch.error };
      return { content, patchSet: patch.patchSet };
    }
    return { content: content || raw.trim() };
  } catch (error) {
    return {
      content: raw.trim(),
      error: {
        code: "INVALID_PATCH",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/** Compatibility parser for existing tests/callers. Legacy suggestions remain display-only. */
export function parseAssistantReply(raw: string): {
  content: string;
  suggestions: ChatSuggestion[];
} {
  const parsed = parseProposalEnvelope(raw);
  if (parsed.patchSet) {
    return {
      content: parsed.content,
      suggestions: [
        {
          title: parsed.patchSet.summary || "Untrusted patch metadata",
          body: "Model-supplied PatchSet metadata is display-only. Regenerate as patchProposal.",
          legacyDisplayOnly: true,
          patchError: {
            code: "INVALID_PATCH",
            message: "The runtime must attach hash and revision metadata",
          },
        },
      ],
    };
  }
  if (parsed.error) {
    return {
      content: parsed.content,
      suggestions: [
        {
          title: "Invalid patch",
          body: parsed.error.message,
          patchError: parsed.error,
          legacyDisplayOnly: true,
        },
      ],
    };
  }

  const legacy = raw.match(/```suggestion\s*([\s\S]*?)```/i);
  if (legacy) {
    return {
      content: raw.replace(legacy[0], "").trim(),
      suggestions: [
        {
          title: "Legacy suggestion",
          body: legacy[1]!.trim(),
          legacyDisplayOnly: true,
          patchError: {
            code: "INVALID_PATCH",
            message: "Legacy suggestion is display-only; regenerate as patchProposal",
          },
        },
      ],
    };
  }
  return { content: parsed.content || raw.trim(), suggestions: [] };
}
