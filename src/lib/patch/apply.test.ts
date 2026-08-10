import { describe, expect, it } from "vitest";
import { undoPatchSet } from "./apply";
import { sha256Hex } from "./hash";
import { projectRevision } from "./revision";
import { parsePatchSet, type PatchSet } from "./schema";
import { simulatePatchSet } from "./simulate";

const TEX = `\\documentclass{article}
\\begin{document}
Old paragraph.
\\end{document}
`;

async function patchFor(
  files: Record<string, string>,
  operations: PatchSet["operations"],
): Promise<PatchSet> {
  return {
    schemaVersion: "1",
    id: crypto.randomUUID(),
    projectRevision: await projectRevision(files),
    summary: "test patch",
    operations,
  };
}

describe("typed patch simulation", () => {
  it("replaces text in place and records exact ranges", async () => {
    const files = { "main.tex": `New appears earlier.\n${TEX}` };
    const oldText = "Old paragraph.";
    const start = files["main.tex"].indexOf(oldText);
    const patch = await patchFor(files, [
      {
        op: "replace_text",
        path: "main.tex",
        baseSha256: await sha256Hex(files["main.tex"]),
        oldText,
        newText: "New paragraph.",
        expectedOccurrences: 1,
        range: { start, end: start + oldText.length },
      },
    ]);

    const result = await simulatePatchSet(files, patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.simulation.nextFiles["main.tex"]).toContain("New paragraph.");
    expect(result.simulation.changes[0]?.afterRange.start).toBe(start);
  });

  it("uses a runtime selection to disambiguate duplicate text", async () => {
    const files = { "main.tex": "same\nsame\n\\end{document}\n" };
    const patch = await patchFor(files, [
      {
        op: "replace_text",
        path: "main.tex",
        baseSha256: await sha256Hex(files["main.tex"]),
        oldText: "same",
        newText: "changed",
        expectedOccurrences: 1,
        range: { start: 5, end: 9 },
      },
    ]);
    const result = await simulatePatchSet(files, patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.simulation.nextFiles["main.tex"]).toBe(
      "same\nchanged\n\\end{document}\n",
    );
  });

  it("rejects new manuscript content after end document", async () => {
    const files = { "main.tex": "Text\n\\end{document}\n" };
    const patch = await patchFor(files, [
      {
        op: "insert_after",
        path: "main.tex",
        baseSha256: await sha256Hex(files["main.tex"]),
        anchor: "\\end{document}",
        text: "\nBad prose",
        expectedOccurrences: 1,
      },
    ]);
    const result = await simulatePatchSet(files, patch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TEX_TRAILING_CONTENT");
  });


  it("rejects hiding trailing prose behind a second end document marker", async () => {
    const files = { "main.tex": "Text\n\\end{document}\n" };
    const patch = await patchFor(files, [
      {
        op: "insert_after",
        path: "main.tex",
        baseSha256: await sha256Hex(files["main.tex"]),
        anchor: "\\end{document}",
        text: "\nBad prose\n\\end{document}",
        expectedOccurrences: 1,
      },
    ]);
    const result = await simulatePatchSet(files, patch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TEX_TRAILING_CONTENT");
  });

  it("rejects prose after a whitespace-tolerant end document marker", async () => {
    const files = { "main.tex": "Text\n\\end { document }\n" };
    const patch = await patchFor(files, [{
      op: "insert_after",
      path: "main.tex",
      baseSha256: await sha256Hex(files["main.tex"]),
      anchor: "\\end { document }",
      text: "\nBad prose",
      expectedOccurrences: 1,
    }]);
    const result = await simulatePatchSet(files, patch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TEX_TRAILING_CONTENT");
  });

  it("rejects an introduced end marker followed by prose", async () => {
    const files = { "main.tex": "Text without a terminator\n" };
    const patch = await patchFor(files, [
      {
        op: "insert_after",
        path: "main.tex",
        baseSha256: await sha256Hex(files["main.tex"]),
        anchor: "Text without a terminator",
        text: "\n\\end{document}\nBad prose",
        expectedOccurrences: 1,
      },
    ]);
    const result = await simulatePatchSet(files, patch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TEX_TRAILING_CONTENT");
  });

  it("deletes a newly created bibliography file on Undo", async () => {
    const files = { "main.tex": "Text\\cite{x}\n\\end{document}\n" };
    const patch = await patchFor(files, [
      {
        op: "bib_add",
        path: "references.bib",
        mustNotExist: true,
        entries: [
          {
            citeKey: "x",
            bibtex: "@article{x,\n  title = {X}\n}",
            normalizedTitle: "x",
          },
        ],
      },
    ]);
    const applied = await simulatePatchSet(files, patch);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.simulation.nextFiles).toHaveProperty("references.bib");

    const undone = await undoPatchSet(
      applied.simulation.nextFiles,
      applied.simulation.snapshots,
      applied.simulation.postApplyHashes,
    );
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(undone.files).not.toHaveProperty("references.bib");
  });

  it("fails all operations atomically when a later operation is invalid", async () => {
    const files = { "main.tex": TEX };
    const hash = await sha256Hex(TEX);
    const patch = await patchFor(files, [
      {
        op: "replace_text",
        path: "main.tex",
        baseSha256: hash,
        oldText: "Old paragraph.",
        newText: "First change.",
        expectedOccurrences: 1,
      },
      {
        op: "replace_text",
        path: "main.tex",
        baseSha256: hash,
        oldText: "Missing text",
        newText: "Second change.",
        expectedOccurrences: 1,
      },
    ]);
    const result = await simulatePatchSet(files, patch);
    expect(result.ok).toBe(false);
    expect(files["main.tex"]).toBe(TEX);
  });

  it("strictly rejects string booleans and unsafe paths", async () => {
    const parsed = parsePatchSet({
      schemaVersion: "1",
      id: "bad",
      projectRevision: await projectRevision({ "main.tex": "x" }),
      summary: "bad",
      verify: { compile: "false" },
      operations: [
        {
          op: "replace_text",
          path: "../main.tex",
          baseSha256: await sha256Hex("x"),
          oldText: "x",
          newText: "y",
          expectedOccurrences: 1,
        },
      ],
    });
    expect(parsed.ok).toBe(false);
  });
});
