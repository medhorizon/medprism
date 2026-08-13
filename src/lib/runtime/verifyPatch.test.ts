import { describe, expect, it } from "vitest";
import { buildContextPackage } from "../context/snapshot";
import { hydratePatchProposal } from "../patch/hydrate";
import { verifyPatchApplication } from "./verifyPatch";

async function patch() {
  const files = { "main.tex": "\\begin{document}\nold\n\\end{document}\n" };
  const context = { projectId: "p", files, mainFile: "main.tex", activeFile: "main.tex" };
  const snapshot = await buildContextPackage(context);
  const hydrated = await hydratePatchProposal({
    schemaVersion: "1",
    summary: "Replace old",
    operations: [{ op: "replace_text", oldText: "old", newText: "new" }],
  }, snapshot);
  if (!hydrated.ok) throw new Error(hydrated.error.message);
  return { context, patchSet: hydrated.patchSet };
}

describe("runtime patch verification", () => {
  it("compiles the immutable post-patch snapshot", async () => {
    const args = await patch();
    const result = await verifyPatchApplication({
      ...args,
      compile: async (request) => ({
        ok: true,
        log: "ok",
        pdfBase64: "pdf",
        projectRevision: request.projectRevision,
      }),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.files["main.tex"]).toContain("new");
  });

  it("returns one root error and nearby source for repair", async () => {
    const args = await patch();
    const result = await verifyPatchApplication({
      ...args,
      compile: async () => ({
        ok: false,
        log: "main.tex:2: Undefined control sequence",
        error: "compile failed",
      }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.stage === "compile") {
      expect(result.repair?.path).toBe("main.tex");
      expect(result.repair?.diagnostic.isRootCause).toBe(true);
      expect(result.repair?.sourceContext).toContain("2: new");
    }
  });
});
