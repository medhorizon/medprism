import { describe, expect, it, vi } from "vitest";
import {
  parseTrustedPaperSearchPayload,
  resolveResearchQuery,
  runResearchStage,
  validateResearchUse,
} from "./service";
import type { ResearchBundle } from "./types";

const context = {
  projectId: "project-1",
  files: { "main.tex": "Text" },
  activeFile: "main.tex",
};

const hit = {
  id: "paper-1",
  title: "Trusted paper",
  authors: "Author A",
  abstract: "Trusted abstract-level evidence.",
};

describe("independent research service", () => {
  it("uses selected text for citation and explicit query for writing", () => {
    expect(resolveResearchQuery({
      spec: { purpose: "citation", query: "broad topic" },
      userText: "add citation",
      selectedText: "exact scientific claim",
    })).toBe("exact scientific claim");
    expect(resolveResearchQuery({
      spec: { purpose: "writing", query: "HCC" },
      userText: "research and write",
      selectedText: "old paragraph",
    })).toBe("HCC");
  });

  it("does not fall back to the full user instruction when the runtime query is missing", () => {
    expect(resolveResearchQuery({
      spec: { purpose: "writing" },
      userText: "research HCC and write Methods",
    })).toBeUndefined();
  });

  it("rejects malformed or duplicate search hits", () => {
    expect(parseTrustedPaperSearchPayload({ hits: [{ id: "x", title: "T", authors: "A" }, { id: "x", title: "T2", authors: "B" }] }).ok).toBe(false);
    expect(parseTrustedPaperSearchPayload({ hits: "bad" }).ok).toBe(false);
  });

  it("executes paper_search once and returns a reusable ResearchBundle", async () => {
    const runTool = vi.fn(async () => ({ ok: true as const, data: { hits: [hit] } }));
    const result = await runResearchStage({
      spec: { purpose: "writing", query: "HCC", requireAbstract: true },
      userText: "research HCC",
      ctx: context,
      runTool,
    });
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bundle).toMatchObject({ query: "HCC", purpose: "writing" });
      expect(result.bundle.hits).toHaveLength(1);
    }
  });

  it("fails before downstream writing when abstract evidence is required but absent", async () => {
    const result = await runResearchStage({
      spec: { purpose: "writing", query: "HCC", requireAbstract: true },
      userText: "research HCC",
      ctx: context,
      runTool: async () => ({
        ok: true,
        data: { hits: [{ id: "title-only", title: "Title", authors: "Author" }] },
      }),
    });
    expect(result).toMatchObject({ ok: false, code: "NO_ABSTRACT_EVIDENCE" });
  });

  it("allows downstream stages to cite only trusted candidate IDs", () => {
    const bundle: ResearchBundle = {
      query: "HCC",
      purpose: "writing",
      hits: [hit],
      warnings: [],
    };
    expect(validateResearchUse({ sourceCandidateIds: ["paper-1"] }, bundle).ok).toBe(true);
    expect(validateResearchUse({ sourceCandidateIds: ["invented"] }, bundle).ok).toBe(false);
  });
});
