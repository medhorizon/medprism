import { describe, expect, it, vi } from "vitest";
import { locateCitationClaim, locateClaimInText } from "./citationClaim";

describe("citation claim location", () => {
  it("locates an exact unique claim", () => {
    const source = "Alpha. Beta needs evidence. Gamma.";
    const range = locateClaimInText(source, "Beta needs evidence.");
    expect(range).toEqual({ start: 7, end: 27 });
  });

  it("rejects non-unique claims", () => {
    const source = "Same claim. Same claim.";
    expect(locateClaimInText(source, "Same claim.")).toBeNull();
  });

  it("asks the model for a claim and binds a runtime selection when none is provided", async () => {
    const claim = "Immune activation worsens outcomes.";
    const source = [
      "\\section{Discussion}",
      claim,
      "More text.",
      "\\bibliography{references}",
      "\\end{document}",
    ].join("\n");
    const complete = vi.fn(async () =>
      JSON.stringify({
        claimText: claim,
        path: "main.tex",
        reason: "Unsupported causal claim",
      }),
    );
    const located = await locateCitationClaim({
      ctx: {
        projectId: "p",
        files: { "main.tex": source },
        activeFile: "main.tex",
        mainFile: "main.tex",
      },
      userText: "帮我给这篇文章的discussion增加引用",
      config: { mode: "mock" },
      target: { kind: "discussion", createIfMissing: false },
      complete,
    });
    expect(located.ok).toBe(true);
    if (!located.ok) return;
    expect(located.claim.selectedText).toBe(claim);
    expect(source.slice(located.claim.selection.start, located.claim.selection.end)).toBe(
      claim,
    );
    expect(complete).toHaveBeenCalledOnce();
  });

  it("fails closed when the model quote is not in the manuscript", async () => {
    const located = await locateCitationClaim({
      ctx: {
        projectId: "p",
        files: {
          "main.tex": "\\section{Discussion}\nReal sentence.\n\\end{document}",
        },
        activeFile: "main.tex",
      },
      userText: "add citations to discussion",
      config: { mode: "mock" },
      target: { kind: "discussion", createIfMissing: false },
      complete: async () =>
        JSON.stringify({
          claimText: "Invented claim that is not present.",
          reason: "x",
        }),
    });
    expect(located.ok).toBe(false);
  });
});
