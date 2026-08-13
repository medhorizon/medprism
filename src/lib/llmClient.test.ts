import { describe, expect, it } from "vitest";
import {
  chatCompletionsRequest,
  formatLlmHttpErrorDetail,
  LLM_DEV_PROXY_BASE_HEADER,
  LLM_DEV_PROXY_PATH,
} from "./llmClient";

describe("chatCompletionsRequest", () => {
  it("uses the Vite same-origin proxy in the browser dev server", () => {
    const target = chatCompletionsRequest("https://newapi.example.com/v1", true);
    expect(target.url).toBe(LLM_DEV_PROXY_PATH);
    expect(target.headers[LLM_DEV_PROXY_BASE_HEADER]).toBe("https://newapi.example.com/v1");
  });

  it("calls the configured host directly outside the Vite dev server", () => {
    const target = chatCompletionsRequest("https://newapi.example.com/v1", false);
    expect(target.url).toBe("https://newapi.example.com/v1/chat/completions");
    expect(target.headers).toEqual({});
  });
});

describe("formatLlmHttpErrorDetail", () => {
  it("unwraps a proxy fetch-failed JSON body", () => {
    expect(
      formatLlmHttpErrorDetail(
        '{"error":"fetch failed: connect ETIMEDOUT 1.2.3.4:443 (https://newapi.example.com)"}',
        502,
      ),
    ).toBe("fetch failed: connect ETIMEDOUT 1.2.3.4:443 (https://newapi.example.com)");
  });
});

