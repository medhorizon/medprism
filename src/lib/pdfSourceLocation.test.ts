import { describe, expect, it } from "vitest";
import { locatePdfTextInSource } from "./pdfSourceLocation";

describe("locatePdfTextInSource", () => {
  it("returns the exact source range around a SyncTeX line", () => {
    const source = ["\\section{Introduction}", "Earlier text.", "A clinically important result was observed.", "Later text."].join("\n");
    const result = locatePdfTextInSource({
      selectedText: "clinically important result",
      candidates: [{ path: "main.tex", line: 3 }],
      files: { "main.tex": source },
    });

    expect(result?.path).toBe("main.tex");
    expect(source.slice(result!.selection.start, result!.selection.end)).toBe("clinically important result");
  });

  it("matches rendered text across formatting commands, citations, and PDF line wrapping", () => {
    const source = "Evidence from \\emph{large cohorts} demonstrates this association\\cite{verified-key}.";
    const result = locatePdfTextInSource({
      selectedText: "Evidence from large cohorts demon-\nstrates this association.",
      candidates: [{ path: "C:\\build\\sections\\intro.tex", line: 1 }],
      files: { "sections/intro.tex": source },
    });

    expect(result?.path).toBe("sections/intro.tex");
    expect(source.slice(result!.selection.start, result!.selection.end)).toBe(
      "Evidence from \\emph{large cohorts} demonstrates this association\\cite{verified-key}.",
    );
  });

  it("matches PDF.js text fragments across visual line breaks without inserted spaces", () => {
    const source = "Hepatocellular carcinoma is a leading cause of cancer-related mortality worldwide.";
    const result = locatePdfTextInSource({
      selectedText: "leading cause of cancer-relatedmortality worldwide",
      candidates: [{ path: "main.tex", line: 1 }],
      files: { "main.tex": source },
    });

    expect(source.slice(result!.selection.start, result!.selection.end)).toBe(
      "leading cause of cancer-related mortality worldwide",
    );
  });

  it("chooses the occurrence nearest the SyncTeX line when text is repeated", () => {
    const source = [
      "\\section{Introduction}",
      "Repeated phrase appears in the opening.",
      "Intervening text.",
      "Intervening text.",
      "The selected repeated phrase appears here.",
    ].join("\n");
    const result = locatePdfTextInSource({
      selectedText: "repeated phrase",
      candidates: [{ path: "main.tex", line: 5 }],
      files: { "main.tex": source },
    });

    expect(source.slice(result!.selection.start, result!.selection.end)).toBe("repeated phrase");
    expect(result!.selection.start).toBe(source.lastIndexOf("repeated phrase"));
  });

  it("does not search unrelated files or outside the candidate line window", () => {
    const distant = `${"filler\n".repeat(20)}target phrase`;
    expect(locatePdfTextInSource({
      selectedText: "target phrase",
      candidates: [{ path: "main.tex", line: 1 }, { path: "missing.tex", line: 21 }],
      files: { "main.tex": distant, "other.tex": "target phrase" },
      lineRadius: 2,
    })).toBeNull();
  });

  it("rejects blank selections and invalid candidate lines", () => {
    expect(locatePdfTextInSource({
      selectedText: "  ",
      candidates: [{ path: "main.tex", line: 1 }],
      files: { "main.tex": "text" },
    })).toBeNull();
    expect(locatePdfTextInSource({
      selectedText: "text",
      candidates: [{ path: "main.tex", line: 0 }],
      files: { "main.tex": "text" },
    })).toBeNull();
  });
});
