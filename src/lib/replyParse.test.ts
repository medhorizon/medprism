import { describe, expect, it } from "vitest";
import { parseAssistantReply } from "./replyParse";

describe("parseAssistantReply", () => {
  it("parses ```patch fence into PatchSet suggestion", () => {
    const raw = `Explain.

\`\`\`patch
{
  "schemaVersion": "1",
  "id": "p1",
  "summary": "Polish intro",
  "operations": [
    {
      "op": "replace_text",
      "path": "main.tex",
      "baseSha256": "abc",
      "oldText": "old",
      "newText": "new",
      "expectedOccurrences": 1
    }
  ]
}
\`\`\`
`;
    const parsed = parseAssistantReply(raw);
    expect(parsed.suggestions).toHaveLength(1);
    expect(parsed.suggestions[0]!.patchSet?.operations[0]?.op).toBe(
      "replace_text",
    );
    expect(parsed.suggestions[0]!.legacyDisplayOnly).toBe(false);
  });

  it("marks legacy suggestion as display-only", () => {
    const raw = `\`\`\`suggestion
path: main.tex
title: Append junk
---
body after end
\`\`\``;
    const parsed = parseAssistantReply(raw);
    expect(parsed.suggestions[0]!.legacyDisplayOnly).toBe(true);
    expect(parsed.suggestions[0]!.patchSet).toBeUndefined();
    expect(parsed.suggestions[0]!.patchError?.code).toBe("INVALID_PATCH");
  });
});
