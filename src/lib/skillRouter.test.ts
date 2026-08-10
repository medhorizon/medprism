import { describe, expect, it } from "vitest";
import { detectSkillIntent, routeWorkflow } from "./skillRouter";

describe("workflow router", () => {
  it.each([
    ["润色这段", "polish"],
    ["重写这一段但不要改变数据", "writing"],
    ["给这句话补引用", "citation"],
    ["修复这个 LaTeX 编译错误", "compile-fix"],
    ["审稿，不要修改", "review"],
    ["只改选区", "writing"],
    ["改表格格式，不要改科学内容", "latex"],
  ] as const)("routes %s to %s", (text, expected) => {
    expect(routeWorkflow({ text }).kind).toBe(expected);
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

});
