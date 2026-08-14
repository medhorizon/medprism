import { describe, expect, it, vi } from "vitest";
import { formulateSearchQuery, parseSearchQueryProposal } from "./formulateQuery";

describe("parseSearchQueryProposal", () => {
  it("accepts a keyword query and a recency year", () => {
    expect(parseSearchQueryProposal(
      JSON.stringify({
        query: "hepatocellular carcinoma mortality incidence",
        sinceYear: 2021,
      }),
      2026,
    )).toEqual({
      query: "hepatocellular carcinoma mortality incidence",
      sinceYear: 2021,
    });
  });

  it("rejects an empty or manuscript-length dump", () => {
    expect(parseSearchQueryProposal(JSON.stringify({ query: "" }))).toBeNull();
    expect(parseSearchQueryProposal(JSON.stringify({
      query: "x".repeat(301),
    }))).toBeNull();
  });

  it("keeps the query when sinceYear is out of range", () => {
    expect(parseSearchQueryProposal(
      JSON.stringify({ query: "HCC screening", sinceYear: 1800 }),
      2026,
    )).toEqual({ query: "HCC screening" });
  });
});

describe("formulateSearchQuery", () => {
  it("returns the parsed query from a non-streaming model call", async () => {
    const complete = vi.fn(async () => JSON.stringify({
      query: "HCC early detection AFP ultrasound",
      sinceYear: 2021,
    }));
    const result = await formulateSearchQuery({
      userText: "为introduction添加引用，要求近5年，至少5篇",
      selectedText: "Hepatocellular carcinoma (HCC) is a major cause of cancer-related morbidity.",
      complete,
      config: { mode: "mock" },
    });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ stream: false }));
    expect(result).toEqual({
      ok: true,
      query: "HCC early detection AFP ultrasound",
      sinceYear: 2021,
    });
  });

  it("fails closed on unusable JSON so the runtime can keep the selected claim", async () => {
    const result = await formulateSearchQuery({
      userText: "补引用",
      selectedText: "A claim.",
      complete: async () => "not json",
      config: { mode: "mock" },
    });
    expect(result).toEqual({ ok: false });
  });
});
