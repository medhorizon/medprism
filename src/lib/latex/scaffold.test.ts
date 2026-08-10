import { describe, expect, it } from "vitest";
import { buildContextSnapshot } from "../context/snapshot";
import { simulatePatchSet } from "../patch/simulate";
import {
  buildScaffoldFromUserText,
  buildStructuralScaffoldPatch,
} from "./scaffold";
import { isStructuralScaffoldRequest } from "../skillRouter";

async function snapshot(files: Record<string, string>, activeFile = "sn-article.tex") {
  return buildContextSnapshot({
    projectId: "p",
    files,
    activeFile,
    mainFile: activeFile,
  });
}

describe("structural scaffold", () => {
  it("detects write-modules-as-LaTeX-structure requests", () => {
    expect(
      isStructuralScaffoldRequest(
        "把这些模块作为 LaTeX 结构写入 sn-article.tex（内容留空或占位）",
      ),
    ).toBe(true);
    expect(
      isStructuralScaffoldRequest(
        "请写入空壳：Funding、Ethics approval、Data availability",
      ),
    ).toBe(true);
  });

  it("inserts only modules parsed from the user checklist", async () => {
    const source = [
      "\\documentclass[pdflatex]{sn-jnl}",
      "\\begin{document}",
      "\\title{Demo Title}",
      "\\author{A. Author}",
      "\\maketitle",
      "\\section{Introduction}",
      "Intro.",
      "\\bibliography{sn-bibliography}",
      "\\end{document}",
    ].join("\n");
    const context = await snapshot({ "sn-article.tex": source });
    const built = await buildScaffoldFromUserText(
      context,
      "搭骨架留白：\n1. Funding\n2. Competing interests\n3. 参考文献\n4. Code availability",
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.parseSource).toBe("checklist");
    expect(built.added).toEqual(
      expect.arrayContaining([
        "Funding",
        "Competing interests",
        "Code availability",
      ]),
    );
    expect(built.added.some((item) => /Ethics/i.test(item))).toBe(false);

    const simulated = await simulatePatchSet(
      { "sn-article.tex": source },
      built.patchSet,
    );
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) return;
    const next = simulated.simulation.nextFiles["sn-article.tex"]!;
    expect(next).toMatch(/Funding|bmhead\{Funding\}/i);
    expect(next).toMatch(/Competing interests/i);
    expect(next).toMatch(/Code availability/i);
  });

  it("falls back to default shells when the request has no concrete list", async () => {
    const source = [
      "\\documentclass[pdflatex]{sn-jnl}",
      "\\begin{document}",
      "\\title{Demo Title}",
      "\\author{A. Author}",
      "\\maketitle",
      "\\section{Introduction}",
      "Intro.",
      "\\section{Methods}",
      "Methods.",
      "\\section{Results}",
      "Results.",
      "\\bibliography{sn-bibliography}",
      "\\end{document}",
    ].join("\n");
    const context = await snapshot({ "sn-article.tex": source });
    const built = await buildScaffoldFromUserText(
      context,
      "把这些模块作为 LaTeX 结构写入 sn-article.tex（内容留空或占位）",
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.parseSource).toBe("default");
    expect(built.added.length).toBeGreaterThan(3);
    expect(built.added).toEqual(
      expect.arrayContaining([
        "Funding",
        "Competing interests",
        "Ethics approval",
        "Author contributions",
      ]),
    );
  });

  it("skips modules that already exist", async () => {
    const source = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\section*{Funding}",
      "Funded.",
      "\\end{document}",
    ].join("\n");
    const context = await snapshot({ "main.tex": source }, "main.tex");
    const built = await buildStructuralScaffoldPatch(context);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.skipped.some((item) => /funding/i.test(item))).toBe(true);
    expect(built.added.some((item) => /funding/i.test(item))).toBe(false);
  });
});
