import scientificWritingSkill from "../../../skills/scientific-writing/SKILL.md?raw";
import academicPaperSkill from "../../../skills/academic-paper/SKILL.md?raw";
import latexPaperEnSkill from "../../../skills/latex-paper-en/SKILL.md?raw";
import naturePolishingSkill from "../../../skills/nature-polishing/SKILL.md?raw";
import natureWritingSkill from "../../../skills/nature-writing/SKILL.md?raw";
import { buildContextSnapshot, formatWorkspaceContext, type ContextSnapshot } from "../context/snapshot";
import { hydratePatchProposal } from "../patch/hydrate";
import type { PatchSet } from "../patch/schema";
import { validatePatchSet } from "../patch/validate";
import { parseModelWorkflowEnvelope } from "../replyParse";
import { taggedPromptData } from "../promptData";
import {
  detectWritingDomain,
  isNatureWritingRequest,
} from "../skillRouter";
import { buildWorkflowSystemPrompt } from "./prompt";
import {
  emptyAgentResult,
  type WorkflowExecutionInput,
  type WorkflowHandler,
  type WorkflowKind,
  type WorkflowResult,
} from "./types";

const WRITING_KINDS = new Set<WorkflowKind>(["writing", "polish", "latex"]);

function projectHint(input: WorkflowExecutionInput): string {
  const path = input.ctx.activeFile ?? input.ctx.mainFile ?? Object.keys(input.ctx.files)[0];
  return path ? (input.ctx.files[path] ?? "").slice(0, 2000) : "";
}

export function selectedWritingSkill(input: WorkflowExecutionInput): {
  id: string;
  text: string;
} {
  if (input.request.kind === "polish") {
    return { id: "nature-polishing", text: naturePolishingSkill };
  }
  if (input.request.kind === "latex") {
    return { id: "latex-paper-en", text: latexPaperEnSkill };
  }
  if (isNatureWritingRequest(input.request.userText)) {
    return { id: "nature-writing", text: natureWritingSkill };
  }
  return detectWritingDomain(input.request.userText, projectHint(input)) === "general"
    ? { id: "academic-paper", text: academicPaperSkill }
    : { id: "scientific-writing", text: scientificWritingSkill };
}

function invalidModelResult(
  kind: WorkflowKind,
  message: string,
  content: string,
): WorkflowResult {
  return {
    agent: emptyAgentResult(kind, "Structured model result was rejected", [message]),
    content: content || `模型结果未通过结构化验证：${message}`,
    toolNotes: [],
  };
}

export const runWritingWorkflow: WorkflowHandler = async (input) => {
  const kind = input.request.kind;
  if (!WRITING_KINDS.has(kind)) {
    return invalidModelResult(kind, `Writing handler cannot execute ${kind}`, "");
  }

  let snapshot: ContextSnapshot;
  try {
    snapshot = await buildContextSnapshot(input.ctx);
  } catch (error) {
    return invalidModelResult(
      kind,
      error instanceof Error ? error.message : String(error),
      "",
    );
  }
  const skill = selectedWritingSkill(input);
  const system = buildWorkflowSystemPrompt({
    workflow: kind,
    skillId: skill.id,
    skill: skill.text,
  });
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: formatWorkspaceContext(snapshot) },
    ...input.history.slice(-10),
    {
      role: "user" as const,
      content: taggedPromptData("user_request", "", { text: input.request.userText }),
    },
  ];
  const raw = await input.services.complete({ config: input.config, messages });
  const parsed = parseModelWorkflowEnvelope(raw, kind);
  if (!parsed.ok) {
    return invalidModelResult(kind, parsed.error.message, parsed.rawContent);
  }
  if (parsed.envelope.citationPlanValue !== undefined || parsed.envelope.reviewValue !== undefined) {
    return invalidModelResult(
      kind,
      `${kind} workflow returned a payload owned by another workflow`,
      parsed.envelope.content,
    );
  }

  let patch: PatchSet | undefined;
  if (parsed.envelope.proposal) {
    const allowedPaths = kind === "latex" && snapshot.mainFile && !snapshot.selection
      ? [...new Set([snapshot.activeFile, snapshot.mainFile])]
      : [snapshot.activeFile];
    const hydrated = await hydratePatchProposal(parsed.envelope.proposal, snapshot, {
      strictSelection: Boolean(snapshot.selection),
      allowedPaths,
      forceCompileVerification: kind === "latex",
    });
    if (!hydrated.ok) {
      return invalidModelResult(kind, hydrated.error.message, parsed.envelope.content);
    }
    const validated = await validatePatchSet({ ...snapshot.files }, hydrated.patchSet);
    if (!validated.ok) {
      return invalidModelResult(kind, validated.error.message, parsed.envelope.content);
    }
    patch = hydrated.patchSet;
  }

  return {
    agent: {
      schemaVersion: "1",
      workflow: kind,
      summary: parsed.envelope.summary,
      warnings: parsed.envelope.warnings,
      ...(patch ? { patch } : {}),
    },
    content: parsed.envelope.content || parsed.envelope.summary,
    toolNotes: [`workflow:${kind}`, `skill:${skill.id}`],
  };
};
