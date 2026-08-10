import { describe, expect, it } from "vitest";
import { buildContextSnapshot } from "../context/snapshot";
import { compileFixProposalToPatch, prepareCompileFix } from "./compileFix";
import type { CompileLogError } from "../../tools/types";

const diagnostic: CompileLogError = {
  severity: "error",
  file: "sections/methods.tex",
  line: 2,
  message: "Undefined control sequence",
  raw: "x",
  isRootCause: true,
};

describe("compile-fix workflow", () => {
  it("scopes one minimal replacement to the diagnosed source window", async () => {
    const snapshot = await buildContextSnapshot({
      projectId: "p",
      files: { "sections/methods.tex": "line1\n\\badcommand\nline3" },
      activeFile: "sections/methods.tex",
    });
    expect(prepareCompileFix(snapshot, diagnostic).ok).toBe(true);
    const result = await compileFixProposalToPatch({
      snapshot,
      diagnostic,
      rawProposal: {
        schemaVersion: "1",
        summary: "remove bad command",
        operations: [{ op: "replace_text", oldText: "\\badcommand", newText: "text" }],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patchSet.verify?.compile).toBe(true);
    expect(result.patchSet.operations[0]).toMatchObject({
      op: "replace_text",
      path: "sections/methods.tex",
    });
  });

  it("keeps exact offsets for CRLF source files", async () => {
    const source = "line1\r\n\\badcommand\r\nline3";
    const snapshot = await buildContextSnapshot({
      projectId: "p",
      files: { "sections/methods.tex": source },
      activeFile: "sections/methods.tex",
    });
    const result = await compileFixProposalToPatch({
      snapshot,
      diagnostic,
      rawProposal: {
        schemaVersion: "1",
        summary: "remove bad command",
        operations: [{ op: "replace_text", oldText: "\\badcommand", newText: "text" }],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.patchSet.operations[0]).toMatchObject({
      range: { start: source.indexOf("\\badcommand"), end: source.indexOf("\\badcommand") + 11 },
    });
  });

  it("rejects cross-file and multi-operation proposals", async () => {
    const snapshot = await buildContextSnapshot({
      projectId: "p",
      files: { "sections/methods.tex": "line1\n\\badcommand\nline3", "main.tex": "x" },
      activeFile: "sections/methods.tex",
    });
    const crossFile = await compileFixProposalToPatch({
      snapshot,
      diagnostic,
      rawProposal: {
        schemaVersion: "1",
        summary: "wrong file",
        operations: [{
          op: "replace_text",
          path: "main.tex",
          oldText: "x",
          newText: "y",
        }],
      },
    });
    expect(crossFile.ok).toBe(false);

    const multi = await compileFixProposalToPatch({
      snapshot,
      diagnostic,
      rawProposal: {
        schemaVersion: "1",
        summary: "too broad",
        operations: [
          { op: "replace_text", oldText: "\\badcommand", newText: "a" },
          { op: "replace_text", oldText: "line1", newText: "b" },
        ],
      },
    });
    expect(multi.ok).toBe(false);
  });
});
