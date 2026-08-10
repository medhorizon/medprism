import { describe, expect, it } from "vitest";
import {
  applyRuntimeScaffoldGuard,
  detectSkillIntent,
  extractResearchQuery,
  routeWorkflow,
} from "./skillRouter";

describe("workflow router", () => {
  it.each([
    "润色这段",
    "重写这一段但不要改变数据",
    "给这句话补引用",
    "修复这个 LaTeX 编译错误",
    "审稿，不要修改",
    "只改选区",
    "只调整 LaTeX 格式",
    "调研 HCC",
  ] as const)("defers natural-language %s to LLM classification (provisional advice)", (text) => {
    const route = routeWorkflow({ text });
    expect(route.needsLlmClassification).toBe(true);
    expect(route.source).toBe("default");
    expect(route.kind).toBe("advice");
    expect(route.plan.applyToLatex).toBe(false);
  });

  it("builds writing plan targets only after an explicit kind is chosen", () => {
    for (const [text, target] of [
      ["帮我就以下关键词取标题：HCC，NMF，scRNA", "title"],
      ["想一个英文标题", "title"],
      ["propose a title for this paper", "title"],
      ["把摘要换成更短的版本", "abstract"],
      ["更新 Methods 部分", "methods"],
      ["改成 Discussion 里的表述", "discussion"],
    ] as const) {
      const route = routeWorkflow({ text, explicitWorkflow: "writing" });
      expect(route.kind).toBe("writing");
      expect(route.plan.target?.kind).toBe(target);
      expect(route.plan.steps).toContain("latex-apply");
      expect(route.needsLlmClassification).toBeFalsy();
    }
  });

  it("models research as an independent stage before writing when kind is writing", () => {
    for (const [text, target] of [
      ["帮我调研 HCC 并写一个摘要", "abstract"],
      ["调研 HCC 后撰写 Methods", "methods"],
      ["调研 HCC 并写 Discussion", "discussion"],
      ["调研该项目并完善 Funding", "funding"],
    ] as const) {
      const route = routeWorkflow({ text, explicitWorkflow: "writing" });
      expect(route.kind).toBe("writing");
      expect(route.plan.steps).toEqual(["research", "writing", "latex-apply"]);
      expect(route.plan.research?.purpose).toBe("writing");
      expect(route.plan.target?.kind).toBe(target);
      expect(route.plan.applyToLatex).toBe(true);
    }
  });

  it("supports research plus polish with a runtime-owned selection target", () => {
    const route = routeWorkflow({ text: "调研 HCC 后润色这段", explicitWorkflow: "polish" });
    expect(route.kind).toBe("polish");
    expect(route.plan.steps).toEqual(["research", "polish", "latex-apply"]);
    expect(route.plan.research?.purpose).toBe("polish");
    expect(route.plan.target).toMatchObject({ kind: "selection" });
  });

  it("supports research plus polish on a named LaTeX section", () => {
    const route = routeWorkflow({
      text: "调研 HCC 后润色 Discussion",
      explicitWorkflow: "polish",
    });
    expect(route.kind).toBe("polish");
    expect(route.plan.steps).toEqual(["research", "polish", "latex-apply"]);
    expect(route.plan.target).toMatchObject({ kind: "discussion" });
  });

  it("supports research plus citation without turning research into a writer", () => {
    const route = routeWorkflow({
      text: "调研 HCC 并给这句话补引用",
      explicitWorkflow: "citation",
    });
    expect(route.kind).toBe("citation");
    expect(route.plan.steps).toEqual(["research", "citation", "latex-apply"]);
    expect(route.plan.research?.purpose).toBe("citation");
  });

  it("keeps a research topic containing 'methods' as research-only without an edit verb", () => {
    const route = routeWorkflow({
      text: "调研 HCC treatment methods",
      explicitWorkflow: "research",
    });
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
    const route = routeWorkflow({
      text: "润色这段并补两篇引用",
      explicitWorkflow: "citation",
    });
    expect(route.kind).toBe("citation");
    expect(route.reviseProse).toBe(true);
  });

  it("attaches a Discussion target for section-scoped citation requests", () => {
    const route = routeWorkflow({
      text: "帮我给这篇文章的discussion增加引用",
      explicitWorkflow: "citation",
    });
    expect(route.kind).toBe("citation");
    expect(route.plan.target).toMatchObject({ kind: "discussion" });
    expect(route.plan.steps).toEqual(["research", "citation", "latex-apply"]);
  });

  it("defers blank-module prep to LLM, then writing plan drops multi-target collapse", () => {
    const text =
      "帮我准备一下模块，内容暂时未空白\n1. 标题页\n2. 摘要\n3. 关键词\n4. 参考文献\n5. 图表\n6. 声明部分 Funding Competing interests\n7. 补充材料";
    expect(routeWorkflow({ text }).needsLlmClassification).toBe(true);
    const route = routeWorkflow({ text, explicitWorkflow: "writing" });
    expect(route.kind).toBe("writing");
    expect(route.plan.steps).toEqual(["writing", "latex-apply"]);
    expect(route.plan.research).toBeUndefined();
    expect(route.plan.target).toBeUndefined();
  });

  it("runtime scaffold guard overrides a misclassified advice route", () => {
    const text = "我想发discover oncology，请检查结构上还有那些并补充，内容留空";
    expect(routeWorkflow({ text }).needsLlmClassification).toBe(true);
    const classifiedAsAdvice = routeWorkflow({
      text,
      explicitWorkflow: "advice",
    });
    expect(classifiedAsAdvice.kind).toBe("advice");
    const guarded = applyRuntimeScaffoldGuard({
      route: classifiedAsAdvice,
      userText: text,
      locked: false,
    });
    expect(guarded.overridden).toBe(true);
    expect(guarded.fromKind).toBe("advice");
    expect(guarded.route.kind).toBe("writing");
    expect(guarded.route.plan.applyToLatex).toBe(true);
  });

  it("runtime scaffold guard does not override locked UI/command routes", () => {
    const text = "内容留空，补充 Funding";
    const locked = applyRuntimeScaffoldGuard({
      route: routeWorkflow({ text, explicitWorkflow: "advice" }),
      userText: text,
      locked: true,
    });
    expect(locked.overridden).toBe(false);
    expect(locked.route.kind).toBe("advice");
  });

  it("does not treat a checklist mention of 参考文献 as citation", () => {
    expect(detectSkillIntent("准备投稿材料：摘要、关键词、参考文献、Funding")).toBe("write");
    expect(detectSkillIntent("给这句话补引用")).toBe("cite");
  });

  it("defers requirement and template gap-check questions to LLM classification", () => {
    for (const text of [
      "我想发scientific reports，除了正文我还要补充哪些",
      "我想发discovery oncology，帮我检查模板还有那些部分需要补充",
    ]) {
      const route = routeWorkflow({ text });
      expect(route.needsLlmClassification).toBe(true);
      expect(route.kind).toBe("advice");
      expect(route.plan.applyToLatex).toBe(false);
    }
  });

  it("marks natural-language turns for closed-set LLM classification", () => {
    const route = routeWorkflow({ text: "嗯，然后呢" });
    expect(route.needsLlmClassification).toBe(true);
    expect(route.plan.applyToLatex).toBe(false);
  });

  it("supports /ask as an explicit advice command", () => {
    const route = routeWorkflow({ text: "/ask 投稿前还要什么声明" });
    expect(route.kind).toBe("advice");
    expect(route.source).toBe("command");
    expect(route.needsLlmClassification).toBeFalsy();
  });

  it("gives an explicit UI action priority over text rules", () => {
    const route = routeWorkflow({
      text: "给这句话补引用",
      explicitWorkflow: "review",
    });
    expect(route.kind).toBe("review");
    expect(route.source).toBe("ui");
  });

  it("supports explicit slash commands before LLM classification", () => {
    expect(routeWorkflow({ text: "/polish 给这句话补引用" }).kind).toBe("polish");
    expect(routeWorkflow({ text: "/polish 给这句话补引用" }).needsLlmClassification).toBeFalsy();
  });

  it("does not let a venue word override an explicit review or polish action", () => {
    expect(
      routeWorkflow({ text: "Review my Nature manuscript, do not edit", explicitWorkflow: "review" })
        .kind,
    ).toBe("review");
    expect(
      routeWorkflow({ text: "润色这段 Nature manuscript", explicitWorkflow: "polish" }).kind,
    ).toBe("polish");
  });

  it("does not mistake ordinary cell-biology prose for a Cell-journal request", () => {
    expect(detectSkillIntent("Write a paragraph about T cell activation")).toBe("write");
    expect(detectSkillIntent("Draft this manuscript for Cell Press")).toBe("nature-writing");
  });

  it("keeps higher-priority compile and review routes when kind is explicit", () => {
    expect(
      routeWorkflow({ text: "修复编译错误后再写一个摘要", explicitWorkflow: "compile-fix" }).kind,
    ).toBe("compile-fix");
    expect(
      routeWorkflow({ text: "审稿并判断摘要是否需要重写", explicitWorkflow: "review" }).kind,
    ).toBe("review");
  });

  it("marks a plain section-writing request as a LaTeX target without research", () => {
    const route = routeWorkflow({
      text: "根据当前项目写一个 Discussion",
      explicitWorkflow: "writing",
    });
    expect(route.kind).toBe("writing");
    expect(route.plan.steps).toEqual(["writing", "latex-apply"]);
    expect(route.plan.target).toMatchObject({ kind: "discussion" });
    expect(route.plan.research).toBeUndefined();
  });

  it("supports a custom named section in Chinese or English", () => {
    expect(
      routeWorkflow({ text: "写一个 Limitations 章节", explicitWorkflow: "writing" }).plan.target,
    ).toMatchObject({
      kind: "section",
      sectionTitle: "Limitations",
    });
    expect(
      routeWorkflow({ text: "Write a Limitations section", explicitWorkflow: "writing" }).plan
        .target,
    ).toMatchObject({
      kind: "section",
      sectionTitle: "Limitations",
    });
  });
});
