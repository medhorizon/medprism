import { describe, expect, it } from "vitest";
import { consumeSseBuffer, extractStreamDelta } from "./llmClient";

describe("llmClient streaming helpers", () => {
  it("extracts delta content from OpenAI SSE payloads", () => {
    expect(
      extractStreamDelta({
        choices: [{ delta: { content: "Hello" } }],
      }),
    ).toBe("Hello");
    expect(extractStreamDelta({ choices: [{ delta: {} }] })).toBe("");
  });

  it("consumes framed SSE buffers and keeps an incomplete trailer", () => {
    const first = consumeSseBuffer(
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: {"choices":[{"delta":{"content":"!"}}]}',
    );
    expect(first.deltas).toEqual(["Hel", "lo"]);
    expect(first.rest.startsWith("data:")).toBe(true);

    const second = consumeSseBuffer(`${first.rest}\n\ndata: [DONE]\n\n`);
    expect(second.deltas).toEqual(["!"]);
    expect(second.rest).toBe("");
  });
});
