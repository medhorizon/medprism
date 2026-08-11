import { describe, expect, it } from "vitest";
import { parseTaskSpec } from "./schema";

const sources = ["artifact-0001", "artifact-0002"];

describe("TaskSpec v2 schema", () => {
  it("accepts GPT-style fenced JSON, numeric version, and trailing commas", () => {
    const parsed = parseTaskSpec(
      '```json\n{"schemaVersion":2,"action":"scaffold","applyMode":"propose-patch","contentMode":"blank","scope":"targets","evidenceMode":"none","targets":[{"slot":"funding","sourceIds":[],}],}\n```',
      sources,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.action).toBe("scaffold");
  });

  it("accepts a DeepSeek-style compact section fill", () => {
    const parsed = parseTaskSpec(JSON.stringify({
      schemaVersion: "2",
      action: "fill-sections",
      applyMode: "propose-patch",
      contentMode: "provided",
      scope: "targets",
      evidenceMode: "none",
      targets: [
        { slot: "funding", sourceIds: ["artifact-0001"] },
        { slot: "data-availability", sourceIds: ["artifact-0002"] },
      ],
    }), sources);
    expect(parsed.ok).toBe(true);
  });

  it("rejects physical patch fields anywhere in the response", () => {
    const parsed = parseTaskSpec(JSON.stringify({
      schemaVersion: "2",
      action: "scaffold",
      applyMode: "propose-patch",
      contentMode: "blank",
      scope: "targets",
      evidenceMode: "none",
      targets: [{ slot: "funding", sourceIds: [], anchor: "\\end{document}" }],
    }), sources);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain("forbidden");
  });

  it("rejects unsupported fields and plain prose", () => {
    const unsupported = parseTaskSpec(JSON.stringify({
      schemaVersion: "2",
      action: "advice",
      applyMode: "answer-only",
      contentMode: "none",
      scope: "active-file",
      evidenceMode: "none",
      targets: [],
      confidence: 0.9,
    }), sources);
    expect(unsupported.ok).toBe(false);
    expect(parseTaskSpec("Plain response", sources).ok).toBe(false);
  });

  it("enforces citation and generated draft invariants", () => {
    const citation = parseTaskSpec(JSON.stringify({
      schemaVersion: "2",
      action: "cite",
      applyMode: "propose-patch",
      contentMode: "none",
      scope: "targets",
      evidenceMode: "none",
      targets: [{ slot: "discussion", sourceIds: [] }],
    }), sources);
    expect(citation.ok).toBe(false);

    const draft = JSON.stringify({
      schemaVersion: "2",
      action: "draft",
      applyMode: "propose-patch",
      contentMode: "generate",
      scope: "targets",
      evidenceMode: "none",
      targets: [{ slot: "ethics", sourceIds: [] }],
    });
    expect(parseTaskSpec(draft, sources).ok).toBe(true);
    expect(parseTaskSpec(draft.replace('"draft"', '"fill-sections"'), sources).ok).toBe(false);
  });

  it("rejects answer-only output when a commit speech act requires a patch", () => {
    const advice = JSON.stringify({
      schemaVersion: "2",
      action: "advice",
      applyMode: "answer-only",
      contentMode: "none",
      scope: "active-file",
      evidenceMode: "none",
      targets: [],
    });
    expect(parseTaskSpec(advice, sources, { requireProposePatch: true }).ok).toBe(false);
  });

  it("rejects unknown source IDs, empty mutation targets, and permission conflicts", () => {
    const fill = {
      schemaVersion: "2",
      action: "fill-sections",
      applyMode: "propose-patch",
      contentMode: "provided",
      scope: "targets",
      evidenceMode: "none",
      targets: [{ slot: "title", sourceIds: ["model-invented-id"] }],
    };
    expect(parseTaskSpec(JSON.stringify(fill), sources).ok).toBe(false);

    const emptyDraft = {
      ...fill,
      action: "draft",
      contentMode: "generate",
      targets: [],
    };
    expect(parseTaskSpec(JSON.stringify(emptyDraft), sources).ok).toBe(false);

    const adviceWithPatchPermission = {
      ...fill,
      action: "advice",
      contentMode: "none",
      targets: [],
    };
    expect(parseTaskSpec(JSON.stringify(adviceWithPatchPermission), sources).ok).toBe(false);

    const validDraft = {
      ...emptyDraft,
      targets: [{ slot: "abstract", sourceIds: [] }],
    };
    expect(parseTaskSpec(JSON.stringify(validDraft), sources, { requireAnswerOnly: true }).ok).toBe(false);
    expect(parseTaskSpec(JSON.stringify({
      ...validDraft,
      scope: "selection",
      targets: [],
    }), sources, { selectionAvailable: false }).ok).toBe(false);
  });

  it("separates conversational writing semantics from file permission", () => {
    const conversationalPolish = {
      schemaVersion: "2",
      action: "polish",
      applyMode: "answer-only",
      contentMode: "generate",
      scope: "manuscript",
      evidenceMode: "none",
      targets: [],
    };
    expect(parseTaskSpec(JSON.stringify(conversationalPolish), sources).ok).toBe(true);
    expect(parseTaskSpec(JSON.stringify({
      ...conversationalPolish,
      applyMode: "propose-patch",
    }), sources).ok).toBe(true);
    expect(parseTaskSpec(JSON.stringify({
      ...conversationalPolish,
      action: "cite",
      applyMode: "propose-patch",
      contentMode: "none",
      evidenceMode: "literature",
    }), sources).ok).toBe(true);
  });

  it("treats runtime permission as authoritative", () => {
    const modelRequestedPatch = JSON.stringify({
      schemaVersion: "2",
      action: "polish",
      applyMode: "propose-patch",
      contentMode: "generate",
      scope: "manuscript",
      evidenceMode: "none",
      targets: [],
    });
    const parsed = parseTaskSpec(modelRequestedPatch, sources, {
      authoritativeApplyMode: "answer-only",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.applyMode).toBe("answer-only");
  });
});
