import { describe, expect, it } from "vitest";
import { classifyWorkflowKind, LLM_ROUTEABLE_KINDS } from "./workflowClassifier";

describe("workflowClassifier", () => {
  it("exposes the closed routeable set", () => {
    expect([...LLM_ROUTEABLE_KINDS].sort()).toEqual([
      "advice",
      "citation",
      "compile-fix",
      "latex",
      "polish",
      "research",
      "review",
      "writing",
    ]);
  });

  it("accepts a valid closed-set JSON reply", async () => {
    const result = await classifyWorkflowKind({
      config: {
        mode: "custom",
        providerName: "test",
        baseUrl: "http://example.test/v1",
        apiKey: "k",
        api: "openai-completions",
        model: "m",
      },
      userText: "这段逻辑有问题吗",
      complete: async () =>
        JSON.stringify({ workflow: "review", reason: "critique request" }),
    });
    expect(result).toEqual({
      kind: "review",
      reason: "critique request",
      source: "llm",
    });
  });

  it("falls back to advice when the model returns an unknown kind", async () => {
    const result = await classifyWorkflowKind({
      config: {
        mode: "custom",
        providerName: "test",
        baseUrl: "http://example.test/v1",
        apiKey: "k",
        api: "openai-completions",
        model: "m",
      },
      userText: "hello",
      complete: async () => JSON.stringify({ workflow: "hack", reason: "nope" }),
    });
    expect(result.kind).toBe("advice");
    expect(result.source).toBe("fallback");
  });
});
