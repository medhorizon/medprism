import {
  parseModelPatchProposal,
  parsePatchSet,
  type ModelPatchProposal,
  type PatchSet,
  type PatchValidationError,
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
  citationPlanValue?: unknown;
  reviewValue?: unknown;
};

export type ParseWorkflowEnvelopeResult =
  | { ok: true; envelope: ModelWorkflowEnvelope }
  | { ok: false; error: PatchValidationError; rawContent: string };

export function extractJsonValue(raw: string): unknown {
  const fence = raw.match(/```json\s*([\s\S]*?)```/i) ?? raw.match(/```patch\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() ?? raw.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("Model response did not contain valid JSON");
  }
}

function invalidWorkflowResult(message: string, raw: string): ParseWorkflowEnvelopeResult {
  return {
    ok: false,
    error: { code: "INVALID_PATCH", message },
    rawContent: raw.trim(),
  };
}

function stringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return [...value];
}

/**
 * Strict Plan07 model-envelope parser. It never upgrades model-supplied runtime
 * metadata into a Keep-eligible PatchSet.
 */
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
  if (record.schemaVersion !== "1") {
    return invalidWorkflowResult("Workflow result schemaVersion must be \"1\"", raw);
  }
  if (record.workflow !== expectedWorkflow) {
    return invalidWorkflowResult(
      `Expected workflow ${expectedWorkflow}, received ${String(record.workflow ?? "<missing>")}`,
      raw,
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
    );
  }

  const payloadCount = [
    record.patchProposal !== undefined,
    record.citationPlan !== undefined,
    record.review !== undefined,
  ].filter(Boolean).length;
  if (payloadCount > 1) {
    return invalidWorkflowResult("Workflow result must contain at most one typed payload", raw);
  }

  let proposal: ModelPatchProposal | undefined;
  if (record.patchProposal !== undefined) {
    const parsed = parseModelPatchProposal(record.patchProposal);
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
      warnings,
      content: typeof record.content === "string" ? record.content.trim() : "",
      ...(proposal ? { proposal } : {}),
      ...(record.citationPlan !== undefined
        ? { citationPlanValue: record.citationPlan }
        : {}),
      ...(record.review !== undefined ? { reviewValue: record.review } : {}),
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

    if (envelope.patchProposal !== undefined) {
      const proposal = parseModelPatchProposal(envelope.patchProposal);
      if (!proposal.ok) return { content, error: proposal.error };
      return { content, proposal: proposal.proposal };
    }
    if (envelope.patchSet !== undefined) {
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
