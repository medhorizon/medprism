import { describe, expect, it } from "vitest";
import { parseTaskSpec } from "./schema";

const segments = ["msg-0001", "msg-0002"];

describe("TaskSpec schema", () => {
  it("accepts GPT-style fenced JSON, numeric version, and trailing commas", () => {
    const parsed = parseTaskSpec(
      '```json\n{"schemaVersion":1,"action":"scaffold","applyMode":"propose-patch","contentMode":"blank","scope":"targets","evidenceMode":"none","targets":[{"slot":"funding","messageSegmentIds":["msg-0001"],}],}\n```',
      segments,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.action).toBe("scaffold");
  });

  it("accepts a DeepSeek-style compact section fill", () => {
    const parsed = parseTaskSpec(
      JSON.stringify({
        schemaVersion: "1",
        action: "fill-sections",
        applyMode: "propose-patch",
        contentMode: "provided",
        scope: "targets",
        evidenceMode: "none",
        targets: [
          { slot: "funding", messageSegmentIds: ["msg-0001"] },
          { slot: "data-availability", messageSegmentIds: ["msg-0002"] },
        ],
      }),
      segments,
    );
    expect(parsed.ok).toBe(true);
  });

  it("rejects physical patch fields anywhere in the response", () => {
    const parsed = parseTaskSpec(
      JSON.stringify({
        schemaVersion: "1",
        action: "scaffold",
        applyMode: "propose-patch",
        contentMode: "blank",
        scope: "targets",
        evidenceMode: "none",
        targets: [{ slot: "funding", messageSegmentIds: [], anchor: "\\end{document}" }],
      }),
      segments,
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain("forbidden");
  });

  it("rejects plain prose instead of surfacing JSON parser details", () => {
    const parsed = parseTaskSpec("已为你准备好伦理声明。", segments);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toMatch(/JSON object/);
  });

  it("enforces citation evidence invariants", () => {
    const parsed = parseTaskSpec(
      JSON.stringify({
        schemaVersion: "1",
        action: "cite",
        applyMode: "propose-patch",
        contentMode: "none",
        scope: "targets",
        evidenceMode: "none",
        targets: [{ slot: "discussion", messageSegmentIds: [] }],
      }),
      segments,
    );
    expect(parsed.ok).toBe(false);
  });
});
