import { describe, expect, it } from "vitest";
import {
  detectSkillIntent,
  extractResearchQuery,
  routeWorkflow,
} from "./skillRouter";

describe("workflow router", () => {
  it.each([
    ["润色这段", "polish"],
    ["重写这一段但不要改变数据", "writing"],
    ["给这句话补引用", "citation"],
    ["修复这个 LaTeX 编译错误", "compile-fix"],
    ["审稿，不要修改", "review"],
    ["只改选区", "writing"],
    ["只调整 LaTeX 格式", "latex"],
    ["调研 HCC", "research"],
  ] as const)("routes %s to %s", (text, expected) => {
    expect(routeWorkflow({ text }).kind).toBe(expected);
  });

  it("models research as an independent stage before writing and LaTeX application", () => {
    for (const [text, target] of [
      ["帮我调研 HCC 并写一个摘要", "abstract"],
      ["调研 HCC 后撰写 Methods", "methods"],
      ["调研 HCC 并写 Discussion", "discussion"],
      ["调研该项目并完善 Funding", "funding"],
    ] as const) {
      const route = routeWorkflow({ text });
      expect(route.kind).toBe("writing");
      expect(route.plan.steps).toEqual(["research", "writing", "latex-apply"]);
      expect(route.plan.research?.purpose).toBe("writing");
      expect(route.plan.target?.kind).toBe(target);
      expect(route.plan.applyToLatex).toBe(true);
    }
  });

  it("supports research plus polish with a runtime-owned selection target", () => {
    const route = routeWorkflow({ text: "调研 HCC 后润色这段" });
    expect(route.kind).toBe("polish");
    expect(route.plan.steps).toEqual(["research", "polish", "latex-apply"]);
    expect(route.plan.research?.purpose).toBe("polish");
    expect(route.plan.target).toMatchObject({ kind: "selection" });
  });

  it("supports research plus polish on a named LaTeX section", () => {
    const route = routeWorkflow({ text: "调研 HCC 后润色 Discussion" });
    expect(route.kind).toBe("polish");
    expect(route.plan.steps).toEqual(["research", "polish", "latex-apply"]);
    expect(route.plan.target).toMatchObject({ kind: "discussion" });
  });

  it("supports research plus citation without turning research into a writer", () => {
    const route = routeWorkflow({ text: "调研 HCC 并给这句话补引用" });
    expect(route.kind).toBe("citation");
    expect(route.plan.steps).toEqual(["research", "citation", "latex-apply"]);
    expect(route.plan.research?.purpose).toBe("citation");
  });

  it("keeps a research topic containing 'methods' as research-only without an edit verb", () => {
    const route = routeWorkflow({ text: "调研 HCC treatment methods" });
    expect(route.kind).toBe("research");
    expect(route.plan.steps).toEqual(["research"]);
    expect(route.plan.target).toBeUndefined();
    expect(route.plan.applyToLatex).toBe(false);
  });

  it("extracts a deterministic research query from common bilingual combinations", () => {
    expect(extractResearchQuery("Research HCC and write an abstract")).toBe("HCC");
    expect(extractResearchQuery("请调研一下 HCC，然后写一段英文摘要")).toBe("HCC");
    expect(extractResearchQuery("检索相关文献并撰写一个关于 HCC 的摘要")).toBe("HCC");
    expect(extractResearchQuery("Research and write an abstract about HCC")).toBe("HCC");
  });

  it("routes polish plus citation to citation with a deterministic prose-revision step", () => {
    const route = routeWorkflow({ text: "润色这段并补两篇引用" });
    expect(route.kind).toBe("citation");
    expect(route.reviseProse).toBe(true);
  });

  it("gives an explicit UI action priority over text rules", () => {
    const route = routeWorkflow({
      text: "给这句话补引用",
      explicitWorkflow: "review",
    });
    expect(route.kind).toBe("review");
    expect(route.source).toBe("ui");
  });

  it("supports explicit slash commands before fallback rules", () => {
    expect(routeWorkflow({ text: "/polish 给这句话补引用" }).kind).toBe("polish");
  });

  it("does not let a venue word override an explicit review or polish action", () => {
    expect(routeWorkflow({ text: "Review my Nature manuscript, do not edit" }).kind).toBe("review");
    expect(routeWorkflow({ text: "润色这段 Nature manuscript" }).kind).toBe("polish");
  });

  it("does not mistake ordinary cell-biology prose for a Cell-journal request", () => {
    expect(detectSkillIntent("Write a paragraph about T cell activation")).toBe("write");
    expect(detectSkillIntent("Draft this manuscript for Cell Press")).toBe("nature-writing");
  });

  it("keeps higher-priority compile and review routes when a target is also mentioned", () => {
    expect(routeWorkflow({ text: "修复编译错误后再写一个摘要" }).kind).toBe("compile-fix");
    expect(routeWorkflow({ text: "审稿并判断摘要是否需要重写" }).kind).toBe("review");
  });

  it("marks a plain section-writing request as a LaTeX target without research", () => {
    const route = routeWorkflow({ text: "根据当前项目写一个 Discussion" });
    expect(route.kind).toBe("writing");
    expect(route.plan.steps).toEqual(["writing", "latex-apply"]);
    expect(route.plan.target).toMatchObject({ kind: "discussion" });
    expect(route.plan.research).toBeUndefined();
  });

  it("supports a custom named section in Chinese or English", () => {
    expect(routeWorkflow({ text: "写一个 Limitations 章节" }).plan.target).toMatchObject({
      kind: "section",
      sectionTitle: "Limitations",
    });
    expect(routeWorkflow({ text: "Write a Limitations section" }).plan.target).toMatchObject({
      kind: "section",
      sectionTitle: "Limitations",
    });
  });
});
