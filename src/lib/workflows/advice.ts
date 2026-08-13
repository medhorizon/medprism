import scientificWritingSkill from "../../../skills/staged/scientific-writing/SKILL.md?raw";
import { formatWorkspaceContext } from "../context/snapshot";
import { taggedPromptData } from "../promptData";
import { parseModelWorkflowEnvelope } from "../replyParse";
import { buildWorkflowSystemPrompt } from "./prompt";
import {
  emptyAgentResult,
  type WorkflowHandler,
  type WorkflowResult,
} from "./types";

function invalidAdvice(message: string): WorkflowResult {
  return {
    agent: emptyAgentResult("advice", "Advice workflow could not be completed", [message]),
    content: `无法完成咨询回复：${message}`,
    toolNotes: [`advice:error:${message}`],
  };
}

/** When GPT emits almost-valid JSON or bare prose, still surface a usable answer. */
function softAdviceFromRaw(raw: string): WorkflowResult | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const contentMatch = trimmed.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (contentMatch?.[1]) {
    try {
      const content = JSON.parse(`"${contentMatch[1]}"`) as string;
      if (content.trim()) {
        return {
          agent: emptyAgentResult("advice", "Advice (recovered from partial JSON)"),
          content: content.trim(),
          toolNotes: ["workflow:advice", "advice:recovered:content-field"],
        };
      }
    } catch {
      // fall through
    }
  }

  if (!/[{`]/.test(trimmed.slice(0, 1)) && !/"workflow"\s*:/.test(trimmed)) {
    return {
      agent: emptyAgentResult("advice", "Advice (plain-text fallback)"),
      content: trimmed,
      toolNotes: ["workflow:advice", "advice:recovered:plaintext"],
    };
  }
  return null;
}

/** Advisory Q&A only — never produces a PatchSet. */
export const runAdviceWorkflow: WorkflowHandler = async (input) => {
  const contextBlock = formatWorkspaceContext(input.contextPackage);

  const raw = await input.services.complete({
    config: input.config,
    messages: [
      {
        role: "system",
        content: buildWorkflowSystemPrompt({
          workflow: "advice",
          skillId: "scientific-writing",
          skill: scientificWritingSkill,
        }),
      },
      ...(contextBlock
        ? [{ role: "user" as const, content: contextBlock }]
        : []),
      ...input.history,
      {
        role: "user",
        content: taggedPromptData("user_request", "", { text: input.request.userText }),
      },
    ],
  });

  const parsed = parseModelWorkflowEnvelope(raw, "advice");
  if (!parsed.ok) {
    const recovered = softAdviceFromRaw(raw);
    if (recovered) return recovered;
    return invalidAdvice(parsed.error.message);
  }
  if (
    parsed.envelope.proposal ||
    parsed.envelope.textDraftValue !== undefined ||
    parsed.envelope.citationPlanValue !== undefined ||
    parsed.envelope.researchReportValue !== undefined ||
    parsed.envelope.reviewValue !== undefined
  ) {
    return invalidAdvice("Advice workflow must not return file edits or typed edit payloads.");
  }

  return {
    agent: {
      schemaVersion: "1",
      workflow: "advice",
      summary: parsed.envelope.summary,
      warnings: parsed.envelope.warnings,
    },
    content: parsed.envelope.content || parsed.envelope.summary,
    toolNotes: ["workflow:advice", "skill:scientific-writing"],
  };
};
