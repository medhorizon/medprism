import { describe, expect, it } from "vitest";
import {
  parseAssistantReply,
  parseModelWorkflowEnvelope,
  parseProposalEnvelope,
} from "./replyParse";

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
  it("rejects a hydrated PatchSet and mismatched workflow in the Plan07 envelope", () => {
    const hydrated = parseModelWorkflowEnvelope(JSON.stringify({
      schemaVersion: "1",
      workflow: "writing",
      summary: "unsafe",
      warnings: [],
      patch: { schemaVersion: "1" },
    }), "writing");
    expect(hydrated.ok).toBe(false);

    const mismatch = parseModelWorkflowEnvelope(JSON.stringify({
      schemaVersion: "1",
      workflow: "review",
      summary: "wrong workflow",
      warnings: [],
      review: { findings: [] },
    }), "writing");
    expect(mismatch.ok).toBe(false);
  });

  it("rejects multiple typed payloads instead of guessing which one to keep", () => {
    const parsed = parseModelWorkflowEnvelope(JSON.stringify({
      schemaVersion: "1",
      workflow: "review",
      summary: "ambiguous",
      warnings: [],
      review: { findings: [] },
      citationPlan: { candidates: [] },
    }), "review");
    expect(parsed.ok).toBe(false);
  });

  it("rejects runtime-owned metadata inside a model patch proposal", () => {
    const withHash = parseModelWorkflowEnvelope(JSON.stringify({
      schemaVersion: "1",
      workflow: "writing",
      summary: "unsafe metadata",
      warnings: [],
      patchProposal: {
        schemaVersion: "1",
        summary: "unsafe",
        operations: [{
          op: "replace_text",
          oldText: "old",
          newText: "new",
          baseSha256: "a".repeat(64),
        }],
      },
    }), "writing");
    expect(withHash.ok).toBe(false);

    const withCompilePolicy = parseModelWorkflowEnvelope(JSON.stringify({
      schemaVersion: "1",
      workflow: "writing",
      summary: "unsafe policy",
      warnings: [],
      patchProposal: {
        schemaVersion: "1",
        summary: "unsafe",
        verify: { compile: true },
        operations: [{ op: "replace_text", oldText: "old", newText: "new" }],
      },
    }), "writing");
    expect(withCompilePolicy.ok).toBe(false);
  });

  it("treats empty patchProposal.operations as advice-only instead of rejecting", () => {
    const parsed = parseModelWorkflowEnvelope(JSON.stringify({
      schemaVersion: "1",
      workflow: "writing",
      summary: "Title options",
      warnings: [],
      content: "Candidate A; Candidate B.",
      patchProposal: {
        schemaVersion: "1",
        summary: "no edit",
        operations: [],
      },
    }), "writing");

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.proposal).toBeUndefined();
    expect(parsed.envelope.content).toBe("Candidate A; Candidate B.");
    expect(parsed.envelope.warnings.some((item) => /empty patchProposal/i.test(item))).toBe(true);
  });

  it("treats null optional payloads as omitted instead of leaking raw JSON", () => {
    const parsed = parseModelWorkflowEnvelope(JSON.stringify({
      schemaVersion: "1",
      workflow: "writing",
      summary: "Draft only",
      warnings: [],
      content: "A normal user-facing paragraph.",
      patchProposal: null,
    }), "writing");

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.proposal).toBeUndefined();
    expect(parsed.envelope.content).toBe("A normal user-facing paragraph.");
  });

  it("accepts a single writingDraft payload for runtime-owned target insertion", () => {
    const parsed = parseModelWorkflowEnvelope(JSON.stringify({
      schemaVersion: "1",
      workflow: "writing",
      summary: "Draft abstract",
      warnings: [],
      writingDraft: {
        kind: "abstract",
        text: "A concise abstract.",
        sourceCandidateIds: ["paper-1"],
      },
    }), "writing");

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.writingDraftValue).toBeDefined();
    expect(parsed.envelope.proposal).toBeUndefined();
  });

});
