import { describe, expect, it } from "vitest";
import { buildConversationArtifacts, validateConversationArtifact } from "./conversationArtifacts";

describe("conversation artifacts", () => {
  it("extracts exact inline Chinese and English assignment values", () => {
    const chinese = buildConversationArtifacts({
      messageId: "u1",
      role: "user",
      content: "修改标题为Single-Cell Transcriptomic NMF Patterns",
    });
    expect(chinese.find((artifact) => artifact.kind === "assignment-value")?.text)
      .toBe("Single-Cell Transcriptomic NMF Patterns");

    const english = buildConversationArtifacts({
      messageId: "u2",
      role: "user",
      content: "Change the title to A Better HCC Screening Model",
    });
    expect(english.find((artifact) => artifact.kind === "assignment-value")?.text)
      .toBe("A Better HCC Screening Model");
  });

  it("extracts stable exact candidates from Markdown title lists", () => {
    const content = "1. **Recommended**\n*First English Title*\n\n2. Alternative\n*Second English Title*";
    const first = buildConversationArtifacts({ messageId: "a1", role: "assistant", content });
    const second = buildConversationArtifacts({ messageId: "a1", role: "assistant", content });
    expect(first).toEqual(second);
    expect(first.filter((artifact) => artifact.kind === "emphasis").map((artifact) => artifact.text))
      .toEqual(["Recommended", "First English Title", "Second English Title"]);
  });

  it("keeps different messages isolated even when candidate text is identical", () => {
    const left = buildConversationArtifacts({ messageId: "a1", role: "assistant", content: "*Same title*" });
    const right = buildConversationArtifacts({ messageId: "a2", role: "assistant", content: "*Same title*" });
    expect(left[0]?.id).not.toBe(right[0]?.id);
  });

  it("rejects forged IDs and ranges even when the text hash is retained", () => {
    const artifact = buildConversationArtifacts({ messageId: "u1", role: "user", content: "Exact text" })[0]!;
    expect(validateConversationArtifact({ ...artifact, id: "model-owned-id" })).toBe(false);
    expect(validateConversationArtifact({ ...artifact, end: artifact.end + 1 })).toBe(false);
  });
});
