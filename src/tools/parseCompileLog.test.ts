import { describe, expect, it } from "vitest";
import { firstRootCompileError, parseCompileLog, compileLogNeedsSourceFix } from "./parseCompileLog";

describe("compile log parser", () => {
  it("selects the first error without promoting an earlier warning", () => {
    const log = [
      "Overfull \\hbox warning",
      "sections/methods.tex:12: Undefined control sequence",
      "! Secondary error",
      "l.18 text",
    ].join("\n");
    const diagnostics = parseCompileLog(log);
    expect(diagnostics[0]?.severity).toBe("warning");
    expect(firstRootCompileError(log)).toMatchObject({
      file: "sections/methods.tex",
      line: 12,
      isRootCause: true,
    });
  });

  it("parses modern Tectonic arrow diagnostics", () => {
    const root = firstRootCompileError([
      "error: Undefined control sequence",
      "  --> sections/methods.tex:12:4",
    ].join("\n"));
    expect(root).toMatchObject({
      severity: "error",
      file: "sections/methods.tex",
      line: 12,
      message: "Undefined control sequence",
      isRootCause: true,
    });
  });

  it("does not invent a path when the log does not identify one", () => {
    const root = firstRootCompileError("! Undefined control sequence\nl.4 \\bad");
    expect(root?.file).toBeUndefined();
  });

  it("treats unresolved citations as a source fix and overfull warnings as not", () => {
    expect(compileLogNeedsSourceFix("Overfull \\hbox (12.0pt too wide)")).toBe(false);
    expect(
      compileLogNeedsSourceFix("Package natbib Warning: There were undefined citations."),
    ).toBe(true);
    expect(
      compileLogNeedsSourceFix("sections/methods.tex:12: Undefined control sequence"),
    ).toBe(true);
  });
});
