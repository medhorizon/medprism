import scientificWritingSkill from "../../../skills/scientific-writing/SKILL.md?raw";
import { taggedPromptData } from "../promptData";
import {
  compactPaperHits,
  researchReportFromBundle,
} from "../research/service";
import { parseModelWorkflowEnvelope } from "../replyParse";
import { buildWorkflowSystemPrompt } from "./prompt";
import {
  emptyAgentResult,
  type WorkflowHandler,
  type WorkflowResult,
} from "./types";

function invalidResearchResult(message: string): WorkflowResult {
  return {
    agent: emptyAgentResult("research", "Research workflow could not be completed", [message]),
    content: `调研流程未能安全完成：${message}`,
    toolNotes: [`research:error:${message}`],
  };
}

/** Standalone user-facing research. Retrieval itself is executed by the executor. */
export const runResearchWorkflow: WorkflowHandler = async (input) => {
  if (!input.research) {
    return invalidResearchResult("Trusted research results are missing.");
  }
  const raw = await input.services.complete({
    config: input.config,
    messages: [
      {
        role: "system",
        content: buildWorkflowSystemPrompt({
          workflow: "research",
          skillId: "scientific-writing",
          skill: scientificWritingSkill,
          capabilities: ["research"],
        }),
      },
      {
        role: "user",
        content: taggedPromptData(
          "trusted_tool_results",
          'source="paper_search"',
          {
            query: input.research.query,
            candidates: compactPaperHits(input.research.hits),
          },
        ),
      },
      {
        role: "user",
        content: taggedPromptData("user_request", "", { text: input.request.userText }),
      },
    ],
  });
  const parsed = parseModelWorkflowEnvelope(raw, "research");
  if (!parsed.ok) return invalidResearchResult(parsed.error.message);
  if (
    parsed.envelope.proposal ||
    parsed.envelope.textDraftValue !== undefined ||
    parsed.envelope.citationPlanValue !== undefined ||
    parsed.envelope.researchReportValue !== undefined ||
    parsed.envelope.reviewValue !== undefined
  ) {
    return invalidResearchResult("Standalone research must return an advisory synthesis without file edits.");
  }

  return {
    agent: {
      schemaVersion: "1",
      workflow: "research",
      summary: parsed.envelope.summary,
      warnings: [...parsed.envelope.warnings, ...input.research.warnings],
      research: researchReportFromBundle(input.research),
    },
    content: parsed.envelope.content || parsed.envelope.summary,
    toolNotes: [
      `research:${input.research.query}:${input.research.hits.length}`,
      "skill:scientific-writing",
    ],
  };
};
