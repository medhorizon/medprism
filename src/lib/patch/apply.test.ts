import { describe, expect, it } from "vitest";
import { applyPatchSet, undoPatchSet } from "./apply";
import { sha256Hex } from "./hash";
import { parsePatchSet, type PatchSet } from "./schema";
import { validatePatchSet } from "./validate";

const SAMPLE_TEX = `\\documentclass{article}
\\begin{document}
\\section{Intro}
Old paragraph here.
\\section{Methods}
Methods text.
\\end{document}
`;

async function texFiles() {
  return { "main.tex": SAMPLE_TEX };
}

async function replacePatch(
  oldText: string,
  newText: string,
  files: Record<string, string>,
  extras: Partial<PatchSet> = {},
): Promise<PatchSet> {
  const baseSha256 = await sha256Hex(files["main.tex"]!);
  return {
    schemaVersion: "1",
    id: "t1",
    summary: "test",
    operations: [
      {
        op: "replace_text",
        path: "main.tex",
        baseSha256,
        oldText,
        newText,
        expectedOccurrences: 1,
      },
    ],
    ...extras,
  };
}

describe("Typed Patch engine", () => {
  it("replaces a normal paragraph in place (before \\end{document})", async () => {
    const files = await texFiles();
    const patch = await replacePatch(
      "Old paragraph here.",
      "New polished paragraph.",
      files,
    );
    const result = await applyPatchSet(patch, files);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files["main.tex"]).toContain("New polished paragraph.");
    expect(result.files["main.tex"]).not.toContain("Old paragraph here.");
    const endIdx = result.files["main.tex"]!.indexOf("\\end{document}");
    const newIdx = result.files["main.tex"]!.indexOf("New polished paragraph.");
    expect(newIdx).toBeGreaterThan(-1);
    expect(newIdx).toBeLessThan(endIdx);
    // Must not append AI body after \\end{document}
    expect(result.files["main.tex"]!.slice(endIdx)).toBe("\\end{document}\n");
  });

  it("replaces content inside \\section{}", async () => {
    const files = await texFiles();
    const patch = await replacePatch(
      "\\section{Intro}",
      "\\section{Introduction}",
      files,
    );
    const result = await applyPatchSet(patch, files);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files["main.tex"]).toContain("\\section{Introduction}");
    expect(result.files["main.tex"]).not.toContain("\\section{Intro}");
  });

  it("rejects missing oldText", async () => {
    const files = await texFiles();
    const patch = await replacePatch("DOES_NOT_EXIST", "x", files);
    const v = await validatePatchSet(patch, files);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.code).toBe("OLD_TEXT_NOT_FOUND");
  });

  it("rejects non-unique oldText", async () => {
    const files = {
      "main.tex": "aaa\nrepeat\nbbb\nrepeat\n\\end{document}\n",
    };
    const patch = await replacePatch("repeat", "once", files);
    const v = await validatePatchSet(patch, files);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error.code).toBe("OLD_TEXT_NOT_UNIQUE");
  });

  it("rejects missing / non-unique anchor", async () => {
    const files = await texFiles();
    const hash = await sha256Hex(files["main.tex"]!);
    const missing = parsePatchSet({
      schemaVersion: "1",
      id: "a1",
      summary: "insert",
      operations: [
        {
          op: "insert_after",
          path: "main.tex",
          baseSha256: hash,
          anchor: "NO_ANCHOR",
          text: "\nX\n",
          expectedOccurrences: 1,
        },
      ],
    });
    expect(missing.ok).toBe(true);
    if (!missing.ok) return;
    const v1 = await validatePatchSet(missing.patchSet, files);
    expect(v1.ok).toBe(false);
    if (!v1.ok) expect(v1.error.code).toBe("ANCHOR_NOT_FOUND");

    const dupFiles = { "main.tex": "AA\nBB\nAA\n" };
    const h2 = await sha256Hex(dupFiles["main.tex"]);
    const dup = parsePatchSet({
      schemaVersion: "1",
      id: "a2",
      summary: "insert",
      operations: [
        {
          op: "insert_before",
          path: "main.tex",
          baseSha256: h2,
          anchor: "AA",
          text: "Z",
          expectedOccurrences: 1,
        },
      ],
    });
    expect(dup.ok).toBe(true);
    if (!dup.ok) return;
    const v2 = await validatePatchSet(dup.patchSet, dupFiles);
    expect(v2.ok).toBe(false);
    if (!v2.ok) expect(v2.error.code).toBe("ANCHOR_NOT_UNIQUE");
  });

  it("rejects stale baseSha256", async () => {
    const files = await texFiles();
    const patch = await replacePatch(
      "Old paragraph here.",
      "New",
      files,
    );
    patch.operations[0] = {
      ...patch.operations[0]!,
      baseSha256: "0".repeat(64),
    };
    const v = await validatePatchSet(patch, files);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.error.code).toBe("BASE_MISMATCH");
  });

  it("multi-op: second failure rolls back (nothing applied)", async () => {
    const files = await texFiles();
    const hash = await sha256Hex(files["main.tex"]!);
    const patch: PatchSet = {
      schemaVersion: "1",
      id: "m1",
      summary: "multi",
      operations: [
        {
          op: "replace_text",
          path: "main.tex",
          baseSha256: hash,
          oldText: "Old paragraph here.",
          newText: "FIRST_OK",
          expectedOccurrences: 1,
        },
        {
          op: "replace_text",
          path: "main.tex",
          baseSha256: hash,
          oldText: "MISSING_SECOND",
          newText: "SECOND",
          expectedOccurrences: 1,
        },
      ],
    };
    const result = await applyPatchSet(patch, files);
    expect(result.ok).toBe(false);
    // Original files unchanged by caller — apply returns new object only on success
    expect(files["main.tex"]).toBe(SAMPLE_TEX);
    expect(files["main.tex"]).not.toContain("FIRST_OK");
  });

  it("bib_add skips duplicate cite-key", async () => {
    const files = {
      "refs.bib": "@article{Foo2020,\n  title={A}\n}\n",
    };
    const hash = await sha256Hex(files["refs.bib"]);
    const patch: PatchSet = {
      schemaVersion: "1",
      id: "b1",
      summary: "bib",
      operations: [
        {
          op: "bib_add",
          path: "refs.bib",
          baseSha256: hash,
          entries: [
            {
              citeKey: "Foo2020",
              bibtex: "@article{Foo2020,\n  title={DUP}\n}",
            },
            {
              citeKey: "Bar2021",
              bibtex: "@article{Bar2021,\n  title={B}\n}",
            },
          ],
        },
      ],
    };
    const result = await applyPatchSet(patch, files);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files["refs.bib"]).toContain("Bar2021");
    expect(result.files["refs.bib"]).not.toContain("title={DUP}");
  });

  it("undo restores pre-Keep content", async () => {
    const files = await texFiles();
    const patch = await replacePatch(
      "Old paragraph here.",
      "Kept text.",
      files,
    );
    const applied = await applyPatchSet(patch, files);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const postApplyHashes: Record<string, string> = {};
    for (const p of applied.affectedPaths) {
      postApplyHashes[p] = await sha256Hex(applied.files[p]!);
    }

    const undone = await undoPatchSet({
      files: applied.files,
      previousFiles: applied.previousFiles,
      postApplyHashes,
    });
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.files["main.tex"]).toBe(SAMPLE_TEX);
  });

  it("undo refuses after manual edit (stale)", async () => {
    const files = await texFiles();
    const patch = await replacePatch(
      "Old paragraph here.",
      "Kept text.",
      files,
    );
    const applied = await applyPatchSet(patch, files);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const postApplyHashes: Record<string, string> = {};
    for (const p of applied.affectedPaths) {
      postApplyHashes[p] = await sha256Hex(applied.files[p]!);
    }

    const edited = {
      ...applied.files,
      "main.tex": applied.files["main.tex"] + "% user edit\n",
    };
    const undone = await undoPatchSet({
      files: edited,
      previousFiles: applied.previousFiles,
      postApplyHashes,
    });
    expect(undone.ok).toBe(false);
    if (!undone.ok) expect(undone.error.code).toBe("BASE_MISMATCH");
  });

  it("rejects empty oldText and unknown op at parse time", () => {
    const empty = parsePatchSet({
      schemaVersion: "1",
      id: "e",
      summary: "x",
      operations: [
        {
          op: "replace_text",
          path: "main.tex",
          baseSha256: "abc",
          oldText: "",
          newText: "y",
          expectedOccurrences: 1,
        },
      ],
    });
    expect(empty.ok).toBe(false);

    const unknown = parsePatchSet({
      schemaVersion: "1",
      id: "e2",
      summary: "x",
      operations: [{ op: "rewrite_file", path: "main.tex" }],
    });
    expect(unknown.ok).toBe(false);
  });

  it("does not EOF-append via legacy body path (apply requires PatchSet)", async () => {
    const { applySuggestionToFiles } = await import("../suggestions");
    const files = await texFiles();
    const result = await applySuggestionToFiles(files, {
      id: "m",
      role: "assistant",
      content: "x",
      suggestion: {
        title: "legacy",
        body: "AI BODY AFTER END",
        path: "main.tex",
        status: "pending",
        legacyDisplayOnly: true,
      },
    });
    expect(result).toBeNull();
    expect(files["main.tex"]).not.toContain("AI BODY AFTER END");
  });
});
