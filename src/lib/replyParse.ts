import {
  parseModelPatchProposal,
  parsePatchSet,
  type ModelPatchProposal,
  type PatchSet,
  type PatchValidationError,
} from "./patch/schema";
import type { ChatSuggestion } from "../types/chat";

export type ProposalEnvelope = {
  content: string;
  proposal?: ModelPatchProposal;
  patchSet?: PatchSet;
  error?: PatchValidationError;
};

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
