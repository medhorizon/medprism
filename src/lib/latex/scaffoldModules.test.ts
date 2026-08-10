import { describe, expect, it } from "vitest";
import {
  isBlankScaffoldIntent,
  parseScaffoldModules,
} from "./scaffoldModules";

describe("parseScaffoldModules", () => {
  it("parses a numbered submission checklist into targetKinds / named sections", () => {
    const text =
      "帮我准备一下模块，内容暂时未空白\n1. 标题页\n2. 摘要\n3. 关键词\n4. 参考文献\n5. 图表\n6. 声明部分 Funding Competing interests\n7. 补充材料";
    const parsed = parseScaffoldModules(text);
    expect(parsed.source).toBe("checklist");
    expect(parsed.modules.map((item) => item.kind)).toEqual(
      expect.arrayContaining([
        "abstract",
        "keywords",
        "funding",
        "conflict-of-interest",
        "section",
      ]),
    );
    expect(
      parsed.modules.some(
        (item) =>
          item.kind === "section" &&
          item.sectionTitle === "Supplementary Information",
      ),
    ).toBe(true);
    expect(parsed.ignored.some((item) => /参考文献|图表|标题页/.test(item))).toBe(
      true,
    );
    expect(parsed.modules.some((item) => item.kind === "title")).toBe(false);
  });

  it("parses an inline targetKind list without using the default table", () => {
    const parsed = parseScaffoldModules(
      "请搭骨架写入空壳：Funding、Ethics approval、Data availability",
    );
    expect(parsed.source).toBe("checklist");
    expect(parsed.modules.map((item) => item.kind)).toEqual([
      "funding",
      "ethics",
      "data-availability",
    ]);
  });

  it("parses English blank Methods/Results shells from mentions", () => {
    const parsed = parseScaffoldModules(
      "Insert empty shells for Methods and Results",
    );
    expect(parsed.source).toBe("mentions");
    expect(parsed.modules.map((item) => item.kind)).toEqual([
      "methods",
      "results",
    ]);
    expect(isBlankScaffoldIntent("Insert empty shells for Methods and Results")).toBe(
      true,
    );
  });

  it("falls back to the default declaration list when nothing concrete is listed", () => {
    const parsed = parseScaffoldModules("把这些模块作为 LaTeX 结构写入，内容留空");
    expect(parsed.source).toBe("default");
    expect(parsed.modules.length).toBeGreaterThan(5);
    expect(parsed.modules.some((item) => item.kind === "funding")).toBe(true);
  });

  it("keeps a custom section title from the checklist", () => {
    const parsed = parseScaffoldModules(
      "准备模块留白：\n1. Funding\n2. Limitations\n3. Code availability",
    );
    expect(parsed.source).toBe("checklist");
    expect(
      parsed.modules.some(
        (item) => item.kind === "section" && item.sectionTitle === "Limitations",
      ),
    ).toBe(true);
    expect(
      parsed.modules.some(
        (item) =>
          item.kind === "section" && item.sectionTitle === "Code availability",
      ),
    ).toBe(true);
  });
});
