import { describe, expect, it } from "vitest";
import { buildWorkflowSystemPrompt, RUNTIME_SKILLS_ENABLED } from "./prompt";

describe("workflow prompt composition", () => {
  it("loads exactly one replacement skill into the workflow prompt", () => {
    const prompt = buildWorkflowSystemPrompt({
      workflow: "writing",
      skillId: "scientific-writing",
      skill: "STAGED_SKILL_SENTINEL",
      capabilities: ["latex-output"],
    });

    expect(RUNTIME_SKILLS_ENABLED).toBe(true);
    expect(prompt).toContain("# MedPrism base policy");
    expect(prompt).toContain("# Workflow: writing");
    expect(prompt).toContain("# Capability: LaTeX application");
    expect((prompt.match(/# Selected skill:/g) ?? [])).toHaveLength(1);
    expect(prompt).toContain("# Selected skill: scientific-writing");
    expect(prompt).toContain("STAGED_SKILL_SENTINEL");
  });
});
