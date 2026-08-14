import { describe, expect, it } from "vitest";
import {
  extractJsonValue,
  parseAssistantReply,
  parseModelWorkflowEnvelope,
  parseProposalEnvelope,
} from "./replyParse";

describe("assistant reply parsing", () => {
  it("accepts a model patch proposal without runtime hashes", () => {
    const parsed = parseProposalEnvelope(JSON.stringify({
      content: "Polished the selected paragraph.",
      summary: "Polish selection",
      patchProposal: {
        operations: [{ op: "replace_text", oldText: "old", newText: "new" }],
      },
    }));
    expect(parsed.proposal?.operations[0]?.op).toBe("replace_text");
    expect(parsed.proposal?.schemaVersion).toBe("1");
    expect(parsed.proposal?.summary).toBe("Polish selection");
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
    if (!hydrated.ok) expect(hydrated.error.code).toBe("RUNTIME_OWNED_FIELD");

    const mismatch = parseModelWorkflowEnvelope(JSON.stringify({
      schemaVersion: "1",
      workflow: "review",
      summary: "wrong workflow",
      warnings: [],
      review: { findings: [] },
    }), "writing");
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error.code).toBe("WRONG_WORKFLOW");
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
    if (!withHash.ok) expect(withHash.error.code).toBe("RUNTIME_OWNED_FIELD");

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
    if (!withCompilePolicy.ok) expect(withCompilePolicy.error.code).toBe("RUNTIME_OWNED_FIELD");
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

  it("tolerates GPT-style trailing commas in workflow JSON", () => {
    const raw = `{
  "schemaVersion": "1",
  "workflow": "advice",
  "summary": "Template gaps",
  "warnings": [],
  "content": "Add competing interests and data availability.",
}`;
    const value = extractJsonValue(raw) as Record<string, unknown>;
    expect(value.workflow).toBe("advice");
    const parsed = parseModelWorkflowEnvelope(raw, "advice");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.content).toContain("competing interests");
  });

  it("accepts numeric schemaVersion 1 from GPT-style JSON", () => {
    const parsed = parseModelWorkflowEnvelope(
      JSON.stringify({
        schemaVersion: 1,
        workflow: "advice",
        summary: "ok",
        warnings: [],
        content: "Hello",
      }),
      "advice",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.schemaVersion).toBe("1");
  });

  it("accepts numeric schemaVersion 1 inside patchProposal", () => {
    const parsed = parseModelWorkflowEnvelope(
      JSON.stringify({
        schemaVersion: "1",
        workflow: "writing",
        summary: "Remove redundant template text",
        warnings: [],
        content: "Prepared a minimal removal.",
        patchProposal: {
          schemaVersion: 1,
          summary: "Remove redundant text",
          operations: [{ op: "replace_text", oldText: "redundant", newText: "" }],
        },
      }),
      "writing",
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.proposal?.schemaVersion).toBe("1");
  });

  it("accepts replace_text that omits oldText", () => {
    const parsed = parseModelWorkflowEnvelope(
      JSON.stringify({
        schemaVersion: "1",
        workflow: "writing",
        summary: "Remove leftover template authors",
        warnings: [],
        patchProposal: {
          operations: [{ op: "replace_text", newText: "" }],
        },
      }),
      "writing",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.proposal?.operations[0]).toMatchObject({
      op: "replace_text",
      oldText: "",
      newText: "",
    });
  });

  it("derives patchProposal.schemaVersion and summary from the envelope", () => {
    const parsed = parseModelWorkflowEnvelope(
      JSON.stringify({
        schemaVersion: "1",
        workflow: "writing",
        summary: "Set authors to Yan Liu, Yishen Li, and Jianpeng Wei",
        warnings: [],
        patchProposal: {
          operations: [{ op: "replace_text", oldText: "Author", newText: "Yan Liu" }],
        },
      }),
      "writing",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.proposal?.schemaVersion).toBe("1");
    expect(parsed.envelope.proposal?.summary).toBe(
      "Set authors to Yan Liu, Yishen Li, and Jianpeng Wei",
    );
  });

  it("ignores an inner patchProposal.summary in favor of the envelope", () => {
    const parsed = parseModelWorkflowEnvelope(
      JSON.stringify({
        schemaVersion: "1",
        workflow: "writing",
        summary: "Fill authors",
        warnings: [],
        patchProposal: {
          summary: "Set author names",
          operations: [{ op: "replace_text", oldText: "Author", newText: "Yan Liu" }],
        },
      }),
      "writing",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.proposal?.schemaVersion).toBe("1");
    expect(parsed.envelope.proposal?.summary).toBe("Fill authors");
  });

  it("still rejects unknown patchProposal schema versions", () => {
    for (const schemaVersion of ["2", 2]) {
      const parsed = parseModelWorkflowEnvelope(
        JSON.stringify({
          schemaVersion: "1",
          workflow: "writing",
          summary: "Invalid version",
          warnings: [],
          patchProposal: {
            schemaVersion,
            summary: "Invalid version",
            operations: [{ op: "replace_text", oldText: "old", newText: "new" }],
          },
        }),
        "writing",
      );
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.message).toContain('patchProposal.schemaVersion must be "1" or 1');
      }
    }
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
