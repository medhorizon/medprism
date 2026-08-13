import { describe, expect, it } from "vitest";
import { lineContextSnippet, splitTextDiff } from "./diffPreview";

describe("diffPreview", () => {
  it("keeps exactly three surrounding lines", () => {
    const content = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n");
    const start = content.indexOf("line 6");
    expect(lineContextSnippet(content, { start, end: start + 6 })).toBe(
      "…\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\n…",
    );
  });

  it("isolates only changed text", () => {
    expect(splitTextDiff("alpha old omega", "alpha new omega")).toEqual({
      prefix: "alpha ",
      beforeChanged: "old",
      afterChanged: "new",
      suffix: " omega",
    });
  });
});
