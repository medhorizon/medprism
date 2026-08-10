/**
 * Deprecated Plan07.1 compatibility adapter.
 * New code uses textWriting.ts plus a runtime-owned LatexTargetSpec.
 */
import type { PaperHit } from "../../tools/types";
import type { ContextSnapshot } from "../context/snapshot";
import {
  parseTextDraft,
  runTargetedTextWorkflow,
  type WritingSkillSelection,
} from "./textWriting";
import type {
  ResearchBundle,
  WorkflowExecutionInput,
  WorkflowResult,
  WritingDraft,
} from "./types";

export type { WritingSkillSelection } from "./textWriting";

export function parseWritingDraft(
  value: unknown,
  trustedHits: readonly PaperHit[],
  researchRequired: boolean,
): { ok: true; draft: WritingDraft } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "writingDraft must be an object" };
  }
  const record = value as Record<string, unknown>;
  if (record.kind !== undefined && record.kind !== "abstract") {
    return { ok: false, message: "Legacy writingDraft.kind must be abstract" };
  }
  const research: ResearchBundle | undefined = researchRequired
    ? {
        query: "compatibility research",
        purpose: "writing",
        hits: [...trustedHits],
        warnings: [],
      }
    : undefined;
  const parsed = parseTextDraft(
    {
      text: record.text,
      format: record.format ?? "plain-text",
      sourceCandidateIds: record.sourceCandidateIds ?? [],
    },
    {
      workflow: "writing",
      hasResearch: researchRequired,
      ...(research ? { research } : {}),
    },
  );
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    draft: {
      kind: "abstract",
      text: parsed.draft.text,
      sourceCandidateIds: parsed.draft.sourceCandidateIds,
    },
  };
}

export async function runAbstractWritingWorkflow(args: {
  input: WorkflowExecutionInput;
  snapshot: ContextSnapshot;
  skill: WritingSkillSelection;
}): Promise<WorkflowResult> {
  return runTargetedTextWorkflow({
    ...args,
    targetSpec: { kind: "abstract", createIfMissing: true },
  });
}
