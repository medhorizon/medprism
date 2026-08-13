import { describe, expect, it } from "vitest";
import { describeFetchError, resolveUpstreamChatUrl } from "./llm-dev-proxy.mjs";

describe("resolveUpstreamChatUrl", () => {
  it("appends /chat/completions", () => {
    expect(resolveUpstreamChatUrl("https://newapi.example.com/v1")).toBe(
      "https://newapi.example.com/v1/chat/completions",
    );
  });

  it("keeps an existing chat completions path", () => {
    expect(resolveUpstreamChatUrl("https://newapi.example.com/v1/chat/completions/")).toBe(
      "https://newapi.example.com/v1/chat/completions",
    );
  });

  it("rejects non-http URLs", () => {
    expect(() => resolveUpstreamChatUrl("file:///etc/passwd")).toThrow(/http or https/);
  });
});

describe("describeFetchError", () => {
  it("joins undici cause messages and the upstream origin", () => {
    const error = new Error("fetch failed", { cause: new Error("connect ETIMEDOUT 1.2.3.4:443") });
    expect(describeFetchError(error, "https://newapi.example.com/v1/chat/completions")).toBe(
      "fetch failed: connect ETIMEDOUT 1.2.3.4:443 (https://newapi.example.com)",
    );
  });
});

