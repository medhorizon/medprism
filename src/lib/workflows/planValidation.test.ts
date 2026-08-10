import { describe, expect, it } from "vitest";
import { validateWorkflowPlan } from "./executor";

describe("validateWorkflowPlan", () => {
  it("rejects review/advice plans that apply latex", () => {
    expect(
      validateWorkflowPlan({
        primary: "review",
        steps: ["review", "latex-apply"],
        applyToLatex: true,
      }),
    ).toMatch(/must not apply LaTeX/);
    expect(
      validateWorkflowPlan({
        primary: "advice",
        steps: ["advice"],
        applyToLatex: true,
      }),
    ).toMatch(/must not apply LaTeX/);
  });

  it("requires citation to include research", () => {
    expect(
      validateWorkflowPlan({
        primary: "citation",
        steps: ["citation", "latex-apply"],
        applyToLatex: true,
      }),
    ).toMatch(/requires a trusted research stage/);
  });

  it("accepts a normal writing plan", () => {
    expect(
      validateWorkflowPlan({
        primary: "writing",
        steps: ["writing", "latex-apply"],
        applyToLatex: true,
      }),
    ).toBeNull();
  });
});
