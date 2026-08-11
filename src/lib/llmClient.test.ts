import { describe, expect, it } from "vitest";
import {
  consumeSseBuffer,
  extractResponseContent,
  extractStreamDelta,
} from "./llmClient";

describe("llmClient streaming helpers", () => {
  it("extracts delta content from OpenAI SSE payloads", () => {
    expect(
      extractStreamDelta({
        choices: [{ delta: { content: "Hello" } }],
      }),
    ).toBe("Hello");
    expect(extractStreamDelta({ choices: [{ delta: {} }] })).toBe("");
    expect(extractStreamDelta({
      choices: [{ delta: { content: [{ type: "text", text: "Array delta" }] } }],
    })).toBe("Array delta");
  });

  it("accepts common OpenAI-compatible non-streaming text shapes", () => {
    expect(extractResponseContent({
      choices: [{ message: { content: [{ type: "text", text: "Hello" }, { type: "text", text: " world" }] } }],
    })).toBe("Hello world");
    expect(extractResponseContent({ choices: [{ text: "Legacy completion" }] }))
      .toBe("Legacy completion");
    expect(extractResponseContent({ output_text: "Responses-compatible text" }))
      .toBe("Responses-compatible text");
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
