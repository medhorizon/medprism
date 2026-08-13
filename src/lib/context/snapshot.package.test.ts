import { describe, expect, it } from "vitest";
import {
  buildContextPackage,
  deriveConversationContext,
  formatContextPackage,
} from "./snapshot";
import { BINARY_FILE_PREFIX } from "../projectBinary";

describe("unified context package", () => {
  it("collects the complete runtime context without exposing binary payloads", async () => {
    const packageValue = await buildContextPackage({
      projectId: "p",
      files: {
        "main.tex": "\\begin{document}\nText\n\\end{document}",
        "refs.bib": "@article{verified, title={Verified}}",
        "figures/result.png": `${BINARY_FILE_PREFIX}c2VjcmV0LWJ5dGVz`,
        "journal.cls": "\\NeedsTeXFormat{LaTeX2e}",
        "README.md": "Follow the journal template.",
      },
      mainFile: "main.tex",
      activeFile: "main.tex",
      cursor: 16,
      lastCompileLog: "main.tex:2: Undefined control sequence",
      memoryNotes: "Preserve observational wording",
      conversationContext: {
        confirmedImagePaths: ["figures/result.png", "missing.png"],
        taskGoal: "Insert the confirmed result figure",
        anchors: ["Results"],
      },
    });

    expect(packageValue.schemaVersion).toBe("1");
    expect(packageValue.mainDocument?.path).toBe("main.tex");
    expect(packageValue.cursor).toBe(16);
    expect(packageValue.bibliographies).toEqual([
      { path: "refs.bib", content: "@article{verified, title={Verified}}", truncated: false },
    ]);
    expect(packageValue.resources.map((resource) => resource.path)).toEqual([
      "README.md",
      "figures/result.png",
      "journal.cls",
    ]);
    expect(packageValue.conversation.confirmedImagePaths).toEqual(["figures/result.png"]);
    const prompt = formatContextPackage(packageValue);
    expect(prompt).toContain("Insert the confirmed result figure");
    expect(prompt).not.toContain("c2VjcmV0LWJ5dGVz");
  });

  it("preserves a collapsed caret and derives only real mentioned image paths", async () => {
    const files = {
      "main.tex": "\\begin{document}\nabc",
      "figures/a.png": `${BINARY_FILE_PREFIX}YQ==`,
    };
    const conversation = deriveConversationContext({
      history: [{ role: "user", content: "Use figures/a.png after \\begin{document}" }],
      userText: "Place it after Results, not missing.png",
      files,
    });
    const packageValue = await buildContextPackage({
      projectId: "p",
      files,
      activeFile: "main.tex",
      cursor: 0,
      conversationContext: conversation,
    });
    expect(packageValue.cursor).toBe(0);
    expect(packageValue.selection).toBeUndefined();
    expect(packageValue.conversation.confirmedImagePaths).toEqual(["figures/a.png"]);
    expect(packageValue.conversation.anchors).toEqual(["\\begin{document}"]);
  });
});
