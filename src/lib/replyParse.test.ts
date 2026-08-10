import { describe, expect, it } from "vitest";
import { parseAssistantReply, parseProposalEnvelope } from "./replyParse";

describe("assistant reply parsing", () => {
  it("accepts a model patch proposal without runtime hashes", () => {
    const parsed = parseProposalEnvelope(JSON.stringify({
      content: "Polished the selected paragraph.",
      patchProposal: {
        schemaVersion: "1",
        summary: "Polish selection",
        operations: [{ op: "replace_text", oldText: "old", newText: "new" }],
      },
    }));
    expect(parsed.proposal?.operations[0]?.op).toBe("replace_text");
    expect(parsed.patchSet).toBeUndefined();
  });

  it("marks a model-supplied full PatchSet as display-only", () => {
    const raw = JSON.stringify({
      content: "Attempted full patch.",
      patchSet: {
        schemaVersion: "1",
        id: "model-owned",
        projectRevision: "a".repeat(64),
        summary: "unsafe metadata",
        operations: [{
          op: "replace_text",
          path: "main.tex",
          baseSha256: "b".repeat(64),
          oldText: "old",
          newText: "new",
          expectedOccurrences: 1,
        }],
      },
    });
    const parsed = parseAssistantReply(raw);
    expect(parsed.suggestions[0]?.legacyDisplayOnly).toBe(true);
    expect(parsed.suggestions[0]?.patchSet).toBeUndefined();
  });

  it("keeps legacy suggestion fences display-only", () => {
    const parsed = parseAssistantReply(
      "```suggestion\npath: main.tex\ntitle: legacy\n---\nbody\n```",
    );
    expect(parsed.suggestions[0]?.legacyDisplayOnly).toBe(true);
  });
});
