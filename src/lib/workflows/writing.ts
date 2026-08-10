import academicPaperSkill from "../../../skills/academic-paper/SKILL.md?raw";
import latexPaperEnSkill from "../../../skills/latex-paper-en/SKILL.md?raw";
import naturePolishingSkill from "../../../skills/nature-polishing/SKILL.md?raw";
import natureWritingSkill from "../../../skills/nature-writing/SKILL.md?raw";
import scientificWritingSkill from "../../../skills/scientific-writing/SKILL.md?raw";
import {
  buildContextSnapshot,
  formatWorkspaceContext,
  type ContextSnapshot,
} from "../context/snapshot";
import { taggedPromptData } from "../promptData";
import { compactPaperHits, validateResearchUse } from "../research/service";
import { parseModelWorkflowEnvelope } from "../replyParse";
import {
  detectWritingDomain,
  isNatureWritingRequest,
} from "../skillRouter";
import { finalizeModelPatchProposal } from "./latexApply";
import { buildWorkflowSystemPrompt } from "./prompt";
import { runTargetedTextWorkflow } from "./textWriting";
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
): WorkflowResult {
  return {
    agent: emptyAgentResult(kind, "Structured model result was rejected", [message]),
    content: `模型结果未通过安全验证，未生成可 Keep 的修改：${message}`,
    toolNotes: [`model-result-rejected:${message}`],
  };
}

export const runWritingWorkflow: WorkflowHandler = async (input) => {
  const kind = input.request.kind;
  if (!WRITING_KINDS.has(kind)) {
    return invalidModelResult(kind, `Writing handler cannot execute ${kind}`);
  }

  let snapshot: ContextSnapshot;
  try {
    snapshot = await buildContextSnapshot(input.ctx);
  } catch (error) {
    return invalidModelResult(
      kind,
      error instanceof Error ? error.message : String(error),
    );
  }
  const skill = selectedWritingSkill(input);
  const target = input.request.plan?.target;

  // All runtime-locatable prose targets use the same trusted LaTeX adapter.
  if ((kind === "writing" || kind === "polish") && target) {
    return runTargetedTextWorkflow({ input, snapshot, skill, targetSpec: target });
  }

  const system = buildWorkflowSystemPrompt({
    workflow: kind,
    skillId: skill.id,
    skill: skill.text,
    capabilities: [
      ...(input.research ? ["research" as const] : []),
      "latex-output",
    ],
  });
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: formatWorkspaceContext(snapshot) },
    ...(input.research
      ? [{
          role: "user" as const,
          content: taggedPromptData(
            "trusted_tool_results",
            'source="paper_search"',
            {
              query: input.research.query,
              purpose: input.research.purpose,
              candidates: compactPaperHits(input.research.hits),
            },
          ),
        }]
      : []),
    ...input.history.slice(-10),
    {
      role: "user" as const,
      content: taggedPromptData("user_request", "", { text: input.request.userText }),
    },
  ];
  const raw = await input.services.complete({ config: input.config, messages });
  const parsed = parseModelWorkflowEnvelope(raw, kind);
  if (!parsed.ok) return invalidModelResult(kind, parsed.error.message);
  if (
    parsed.envelope.textDraftValue !== undefined ||
    parsed.envelope.citationPlanValue !== undefined ||
    parsed.envelope.researchReportValue !== undefined ||
    parsed.envelope.reviewValue !== undefined
  ) {
    return invalidModelResult(
      kind,
      `${kind} workflow returned a payload owned by another workflow or requires a runtime target`,
    );
  }

  if (input.research && parsed.envelope.proposal) {
    if (parsed.envelope.researchUseValue === undefined) {
      return invalidModelResult(
        kind,
        "Research-assisted source edits must declare researchUse.sourceCandidateIds",
      );
    }
    const use = validateResearchUse(
      parsed.envelope.researchUseValue,
      input.research,
      true,
    );
    if (!use.ok) return invalidModelResult(kind, use.message);
  } else if (!input.research && parsed.envelope.researchUseValue !== undefined) {
    return invalidModelResult(
      kind,
      "A non-research workflow must not claim trusted research candidates",
    );
  }

  const proposal = parsed.envelope.proposal;
  if (!proposal) {
    return {
      agent: emptyAgentResult(kind, parsed.envelope.summary, [
        ...parsed.envelope.warnings,
        ...(input.research?.warnings ?? []),
      ]),
      content: parsed.envelope.content || parsed.envelope.summary,
      toolNotes: [
        `workflow:${kind}:no-patch`,
        `skill:${skill.id}`,
        ...(input.research
          ? [`research:${input.research.query}:${input.research.hits.length}`]
          : []),
      ],
    };
  }

  const allowedPaths = kind === "latex" && snapshot.mainFile && !snapshot.selection
    ? [...new Set([snapshot.activeFile, snapshot.mainFile])]
    : [snapshot.activeFile];
  const finalized = await finalizeModelPatchProposal({
    snapshot,
    proposal,
    strictSelection: Boolean(snapshot.selection),
    allowedPaths,
    forceCompileVerification: kind === "latex",
  });
  if (!finalized.ok) return invalidModelResult(kind, finalized.error.message);

  return {
    agent: {
      schemaVersion: "1",
      workflow: kind,
      summary: parsed.envelope.summary,
      warnings: [...parsed.envelope.warnings, ...(input.research?.warnings ?? [])],
      patch: finalized.patchSet,
    },
    content: parsed.envelope.content || parsed.envelope.summary,
    toolNotes: [
      `workflow:${kind}`,
      `skill:${skill.id}`,
      ...(input.research
        ? [`research:${input.research.query}:${input.research.hits.length}`]
        : []),
    ],
  };
};
