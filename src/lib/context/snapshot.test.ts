import { describe, expect, it } from "vitest";
import { buildContextSnapshot, formatWorkspaceContext } from "./snapshot";
import { hydratePatchProposal } from "../patch/hydrate";

describe("context snapshot", () => {
  it("includes optional project memory notes in workspace context", async () => {
    const snapshot = await buildContextSnapshot({
      projectId: "p",
      files: { "main.tex": "\\begin{document}\\end{document}" },
      activeFile: "main.tex",
      memoryNotes: "  Prefer cohort wording  ",
    });
    expect(snapshot.memoryNotes).toBe("Prefer cohort wording");
    expect(formatWorkspaceContext(snapshot)).toContain("projectMemoryNotes");
    expect(formatWorkspaceContext(snapshot)).toContain("Prefer cohort wording");
    expect(formatWorkspaceContext(snapshot)).toContain("fileTree");
    expect(formatWorkspaceContext(snapshot)).toContain("mainDocument");
  });

  it("computes selected text from the active file, including surrogate pairs", async () => {
    const snapshot = await buildContextSnapshot({
      projectId: "p",
      files: { "main.tex": "main", "sections/methods.tex": "a😀b" },
      mainFile: "main.tex",
      activeFile: "sections/methods.tex",
      selection: { start: 1, end: 3 },
    });
    expect(snapshot.activeFile).toBe("sections/methods.tex");
    expect(snapshot.selectedText).toBe("😀");
  });

  it("hydrates runtime hash/revision and rejects selection escape", async () => {
    const snapshot = await buildContextSnapshot({
      projectId: "p",
      files: { "main.tex": "same\nsame\n\\end{document}\n" },
      activeFile: "main.tex",
      selection: { start: 5, end: 9 },
    });
    const ok = await hydratePatchProposal(
      {
        schemaVersion: "1",
        summary: "replace selection",
        operations: [{ op: "replace_text", oldText: "same", newText: "changed" }],
      },
      snapshot,
      { strictSelection: true },
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.patchSet.projectRevision).toMatch(/^[a-f0-9]{64}$/);
      expect(ok.patchSet.operations[0]).toMatchObject({
        path: "main.tex",
        range: { start: 5, end: 9 },
      });
    }

    const escaped = await hydratePatchProposal(
      {
        schemaVersion: "1",
        summary: "escape",
        operations: [{ op: "replace_text", path: "other.tex", oldText: "same", newText: "x" }],
      },
      snapshot,
      { strictSelection: true },
    );
    expect(escaped.ok).toBe(false);
  });

  it("uses the selected span as oldText even when the model echoes a different string", async () => {
    const source = "keep\nContributing authors: iauthor@gmail.com;\nkeep";
    const selected = "Contributing authors: iauthor@gmail.com;\n";
    const snapshot = await buildContextSnapshot({
      projectId: "p",
      files: { "main.tex": source },
      activeFile: "main.tex",
      selection: {
        start: source.indexOf(selected),
        end: source.indexOf(selected) + selected.length,
      },
    });
    const hydrated = await hydratePatchProposal(
      {
        schemaVersion: "1",
        summary: "Remove leftover template authors",
        operations: [{ op: "replace_text", oldText: "iauthor@gmail.com", newText: "" }],
      },
      snapshot,
      { strictSelection: true },
    );
    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) return;
    expect(hydrated.patchSet.operations[0]).toMatchObject({
      oldText: selected,
      newText: "",
      range: snapshot.selection,
    });
  });
});
