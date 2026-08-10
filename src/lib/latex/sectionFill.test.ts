import { describe, expect, it } from "vitest";
import { buildContextSnapshot } from "../context/snapshot";
import { simulatePatchSet } from "../patch/simulate";
import {
  buildSectionFillFromUserText,
  isProvidedSectionFillRequest,
  parseProvidedSectionFills,
  repairPastedProseWraps,
} from "./sectionFill";

const USER_PASTE = `帮我补充：
Author contributions Y.L, J.B.L, and H.W performed experiments 
and analyzed data. S.M.S, B.G., X.Y.W., and B.S.W. performed ex
periments. Y.S.L. designed and performed experiments, analyzed data, 
and wrote manuscript. T.W. designed experiments, supervised the 
project, and wrote manuscript. All authors read and approved the final 
manuscript.
Funding This work was supported by the National Natural Science 
Foundation of China [No. 82073877].
Data availability All data generated during this study were included 
in this article.`;

describe("provided section fills", () => {
  it("repairs PDF soft wraps inside words", () => {
    expect(repairPastedProseWraps("ex\nperiments")).toBe("experiments");
    expect(repairPastedProseWraps("per-\nformed")).toBe("performed");
  });

  it("parses labeled multi-section paste without inventing anchors", () => {
    expect(isProvidedSectionFillRequest(USER_PASTE)).toBe(true);
    const fills = parseProvidedSectionFills(USER_PASTE);
    expect(fills.map((item) => item.spec.kind)).toEqual([
      "author-contributions",
      "funding",
      "data-availability",
    ]);
    expect(fills[0]?.text).toMatch(/Y\.L/);
    expect(fills[0]?.text).toMatch(/experiments/);
    expect(fills[0]?.text).not.toMatch(/\bex\s+periments\b/);
    expect(fills[1]?.text).toMatch(/82073877/);
    expect(fills[2]?.text).toMatch(/All data generated/);
  });

  it("does not treat blank scaffold checklists as provided fills", () => {
    expect(
      isProvidedSectionFillRequest(
        "准备模块留白：\n1. Funding\n2. Data availability\n3. Author contributions",
      ),
    ).toBe(false);
  });

  it("builds a Keep-ready patch for missing declaration sections", async () => {
    const snapshot = await buildContextSnapshot({
      projectId: "p1",
      files: {
        "main.tex": [
          "\\documentclass{article}",
          "\\begin{document}",
          "\\section{Discussion}",
          "Body.",
          "\\end{document}",
        ].join("\n"),
      },
      activeFile: "main.tex",
      mainFile: "main.tex",
    });

    const built = await buildSectionFillFromUserText(snapshot, USER_PASTE);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.message);

    expect(built.applied).toEqual([
      "author contributions",
      "funding",
      "data availability",
    ]);
    const simulated = await simulatePatchSet(snapshot.files, built.patchSet);
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) throw new Error(simulated.error.message);

    const next = simulated.simulation.nextFiles["main.tex"]!;
    expect(next).toMatch(/\\section\*\{Author contributions\}/);
    expect(next).toMatch(/Y\.L/);
    expect(next).toMatch(/\\section\*\{Funding\}/);
    expect(next).toMatch(/82073877/);
    expect(next).toMatch(/\\section\*\{Data availability\}/);
    expect(next).toMatch(/All data generated/);
    expect(next.indexOf("\\end{document}")).toBeGreaterThan(
      next.indexOf("Data availability"),
    );
  });

  it("replaces existing section bodies when labels already exist", async () => {
    const snapshot = await buildContextSnapshot({
      projectId: "p1",
      files: {
        "main.tex": [
          "\\documentclass{article}",
          "\\begin{document}",
          "\\section*{Funding}",
          "Old funding.",
          "\\section*{Data availability}",
          "Old data.",
          "\\end{document}",
        ].join("\n"),
      },
      activeFile: "main.tex",
      mainFile: "main.tex",
    });

    const built = await buildSectionFillFromUserText(
      snapshot,
      [
        "补充：",
        "Funding This work was supported by NSFC [No. 82073877].",
        "Data availability All data are in this article.",
      ].join("\n"),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.message);

    const simulated = await simulatePatchSet(snapshot.files, built.patchSet);
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) throw new Error(simulated.error.message);
    const next = simulated.simulation.nextFiles["main.tex"]!;
    expect(next).toContain("82073877");
    expect(next).toContain("All data are in this article");
    expect(next).not.toContain("Old funding");
    expect(next).not.toContain("Old data");
  });
});
