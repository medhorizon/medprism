import scientificWritingSkill from "../../../skills/scientific-writing/SKILL.md?raw";
import { taggedPromptData } from "../promptData";
import { emptyAgentResult, type WorkflowHandler, type WorkflowResult } from "./types";

function unavailable(message: string): WorkflowResult {
  return {
    agent: emptyAgentResult("advice", "Advice could not be completed", [message]),
    content: "The request could not be answered safely. No manuscript changes were created.",
    toolNotes: [`workflow:advice:error:${message}`],
  };
}

function asksForCurrentSubmissionPolicy(text: string): boolean {
  return /(?:latest|current|up[- ]?to[- ]?date|submission (?:policy|guideline|requirement)|journal (?:policy|guideline|requirement)|最新|当前|投稿(?:政策|指南|要求)|期刊(?:政策|指南|要求))/i.test(text);
}

/** Plain-text, streamable, answer-only advice on resolved manuscript context. */
export const runAdviceWorkflow: WorkflowHandler = async (input) => {
  const resolved = input.request.resolvedTask;
  if (!resolved) return unavailable("Resolved TaskSpec context is missing");
  const semanticInstruction = resolved.spec.action === "polish"
    ? "Rewrite or translate the requested scientific text directly in the answer. Do not claim that a project file was changed."
    : resolved.spec.action === "draft"
      ? "Draft the requested scientific text directly in the answer. Do not claim that a project file was changed."
      : "Answer the user's scientific-writing question directly.";
  const context = resolved.contextBlocks.map((block) => ({
    id: block.id,
    path: block.path,
    text: block.text,
  }));
  const raw = await input.services.complete({
    config: input.config,
    messages: [
      {
        role: "system",
        content: [
          "You are MedPrism's advice-only scientific writing assistant.",
          semanticInstruction,
          "Answer the user directly in plain text. Never propose, describe, or encode file patches.",
          "Preserve claim strength and never invent data, citations, journal policies, DOI, or PMID.",
          "If the user asks for current journal submission requirements, explain that no official guideline retrieval was performed and that requirements must be verified against the journal website.",
          scientificWritingSkill,
        ].join("\n\n"),
      },
      ...input.history,
      {
        role: "user",
        content: taggedPromptData("workspace_context", 'trust="untrusted-data"', {
          context,
        }),
      },
      {
        role: "user",
        content: taggedPromptData("user_request", "", { text: input.request.userText }),
      },
    ],
  });
  const answer = raw.trim();
  if (!answer) return unavailable("The model returned an empty answer");
  const policyLimitation = asksForCurrentSubmissionPolicy(input.request.userText)
    ? "Time-sensitive note: no official journal guideline source was retrieved for this answer; verify current submission requirements on the journal's official website."
    : undefined;
  const content = policyLimitation ? `${answer}\n\n${policyLimitation}` : answer;
  return {
    agent: {
      schemaVersion: "1",
      workflow: "advice",
      summary: "Advice response",
      warnings: resolved.warnings,
    },
    content,
    toolNotes: [
      ...resolved.toolNotes,
      "workflow:advice:plain-text",
      ...(policyLimitation ? ["advice:current-policy-unverified"] : []),
    ],
  };
};
