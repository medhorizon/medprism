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

/** Plain-text, streamable, answer-only advice on resolved manuscript context. */
export const runAdviceWorkflow: WorkflowHandler = async (input) => {
  const resolved = input.request.resolvedTask;
  if (!resolved) return unavailable("Resolved TaskSpec context is missing");
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
  const content = raw.trim();
  if (!content) return unavailable("The model returned an empty answer");
  return {
    agent: {
      schemaVersion: "1",
      workflow: "advice",
      summary: "Advice response",
      warnings: resolved.warnings,
    },
    content,
    toolNotes: [...resolved.toolNotes, "workflow:advice:plain-text"],
  };
};
