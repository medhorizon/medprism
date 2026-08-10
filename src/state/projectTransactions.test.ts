import { describe, expect, it } from "vitest";
import { projectRevision } from "../lib/patch/revision";
import { sha256Hex } from "../lib/patch/hash";
import { keepSuggestionTransaction } from "./projectTransactions";

describe("project transactions", () => {
  it("rejects a Keep when the user edits during asynchronous preparation", async () => {
    const files = { "main.tex": "old\n\\end{document}\n" };
    const patchSet = {
      schemaVersion: "1" as const,
      id: "p",
      projectRevision: await projectRevision(files),
      summary: "replace",
      operations: [{
        op: "replace_text" as const,
        path: "main.tex",
        baseSha256: await sha256Hex(files["main.tex"]),
        oldText: "old",
        newText: "new",
        expectedOccurrences: 1 as const,
      }],
    };
    const start = { id: "p", revision: 1, files };
    const changed = {
      id: "p",
      revision: 2,
      files: { "main.tex": "user edit\n\\end{document}\n" },
    };
    let reads = 0;
    let committed = false;
    const result = await keepSuggestionTransaction({
      getCurrent: () => (++reads === 1 ? start : changed),
      commit: (project) => {
        committed = true;
        return project;
      },
      message: {
        id: "m",
        role: "assistant",
        content: "",
        suggestion: { title: "replace", body: "", patchSet },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROJECT_REVISION_MISMATCH");
    expect(committed).toBe(false);
  });
});
