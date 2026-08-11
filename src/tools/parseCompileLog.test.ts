import { describe, expect, it } from "vitest";
import { firstRootCompileError, parseCompileLog } from "./parseCompileLog";

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

  it("keeps undefined citation warnings visible", () => {
    const log = [
      "LaTeX Warning: Citation `RogersG2026diagnostic' on page 2 undefined on input line 57.",
      "Package natbib Warning: There were undefined citations.",
    ].join("\n");
    const diagnostics = parseCompileLog(log);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "warning" }),
        expect.objectContaining({ severity: "warning" }),
      ]),
    );
    expect(firstRootCompileError(log)).toBeUndefined();
  });
});
