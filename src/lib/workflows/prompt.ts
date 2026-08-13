import basePolicy from "../../../prompts/system.med-writer.md?raw";
import researchInstruction from "../../../prompts/workflows/research.md?raw";
import writingInstruction from "../../../prompts/workflows/writing.md?raw";
import polishInstruction from "../../../prompts/workflows/polish.md?raw";
import citationInstruction from "../../../prompts/workflows/citation.md?raw";
import latexInstruction from "../../../prompts/workflows/latex.md?raw";
import compileFixInstruction from "../../../prompts/workflows/compile-fix.md?raw";
import reviewInstruction from "../../../prompts/workflows/review.md?raw";
import adviceInstruction from "../../../prompts/workflows/advice.md?raw";
import researchCapability from "../../../prompts/capabilities/research.md?raw";
import latexOutputCapability from "../../../prompts/capabilities/latex-output.md?raw";
import type { WorkflowKind } from "./types";

const WORKFLOW_INSTRUCTIONS: Record<WorkflowKind, string> = {
  research: researchInstruction,
  writing: writingInstruction,
  polish: polishInstruction,
  citation: citationInstruction,
  latex: latexInstruction,
  "compile-fix": compileFixInstruction,
  review: reviewInstruction,
  advice: adviceInstruction,
};

const CAPABILITY_INSTRUCTIONS = {
  research: researchCapability,
  "latex-output": latexOutputCapability,
} as const;

export type PromptCapability = keyof typeof CAPABILITY_INSTRUCTIONS;

/** Replacement skills are loaded one at a time by the active workflow. */
export const RUNTIME_SKILLS_ENABLED = true;

export function buildWorkflowSystemPrompt(args: {
  workflow: WorkflowKind;
  skillId: string;
  skill: string;
  /** Optional deterministic workflow variant, e.g. targeted text generation. */
  instruction?: string;
  capabilities?: PromptCapability[];
}): string {
  const capabilityBlocks = [...new Set(args.capabilities ?? [])].map(
    (capability) => CAPABILITY_INSTRUCTIONS[capability].trim(),
  );
  const skillBlocks = RUNTIME_SKILLS_ENABLED
    ? [
        `# Selected skill: ${args.skillId}`,
        args.skill.trim(),
        "# Precedence",
        "The base policy and active workflow instruction override conflicting examples in the selected skill.",
      ]
    : [];
  return [
    basePolicy.trim(),
    (args.instruction ?? WORKFLOW_INSTRUCTIONS[args.workflow]).trim(),
    ...capabilityBlocks,
    ...skillBlocks,
  ].join("\n\n");
}
