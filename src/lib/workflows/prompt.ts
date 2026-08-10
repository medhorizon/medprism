import basePolicy from "../../../prompts/system.med-writer.md?raw";
import writingInstruction from "../../../prompts/workflows/writing.md?raw";
import polishInstruction from "../../../prompts/workflows/polish.md?raw";
import citationInstruction from "../../../prompts/workflows/citation.md?raw";
import latexInstruction from "../../../prompts/workflows/latex.md?raw";
import compileFixInstruction from "../../../prompts/workflows/compile-fix.md?raw";
import reviewInstruction from "../../../prompts/workflows/review.md?raw";
import type { WorkflowKind } from "./types";

const WORKFLOW_INSTRUCTIONS: Record<WorkflowKind, string> = {
  writing: writingInstruction,
  polish: polishInstruction,
  citation: citationInstruction,
  latex: latexInstruction,
  "compile-fix": compileFixInstruction,
  review: reviewInstruction,
};

export function buildWorkflowSystemPrompt(args: {
  workflow: WorkflowKind;
  skillId: string;
  skill: string;
}): string {
  return [
    basePolicy.trim(),
    WORKFLOW_INSTRUCTIONS[args.workflow].trim(),
    `# Selected skill: ${args.skillId}`,
    args.skill.trim(),
    "# Precedence",
    "The base policy and active workflow instruction override conflicting examples in the selected skill.",
  ].join("\n\n");
}
