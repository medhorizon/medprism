import { describe, expect, it } from "vitest";
import { buildContextSnapshot } from "../context/snapshot";
import { buildConversationArtifacts } from "../conversationArtifacts";
import { buildManuscriptModel } from "../manuscript/model";
import type { completeStructured } from "../llmClient";
import { interpretTaskSpec, requestsFileCommit } from "./interpreter";

async function model() {
  const snapshot = await buildContextSnapshot({
    projectId: "p",
    files: { "main.tex": "\\documentclass{article}\n\\begin{document}\n\\title{Old}\n\\end{document}" },
    mainFile: "main.tex",
  });
  return buildManuscriptModel(snapshot);
}

describe("TaskSpec v2 interpreter", () => {
  it("distinguishes brainstorming from explicit commit speech acts", () => {
    expect(requestsFileCommit("帮我就这些关键词取几个标题")).toBe(false);
    expect(requestsFileCommit("英文改写标题：《旧标题》")).toBe(false);
    expect(requestsFileCommit("如何修改这个标题？")).toBe(false);
    expect(requestsFileCommit("检查全文但不要修改项目文件")).toBe(false);
    expect(requestsFileCommit("帮我写一段摘要")).toBe(true);
    expect(requestsFileCommit("修改标题为A New Title")).toBe(true);
    expect(requestsFileCommit("采用第 3 个标题")).toBe(true);
    expect(requestsFileCommit("用刚才的英文标题")).toBe(true);
    expect(requestsFileCommit("Change the title to A New Title")).toBe(true);
  });

  it("uses trusted historical artifact ids and does not duplicate the current turn in history", async () => {
    const prior = buildConversationArtifacts({ messageId: "a1", role: "assistant", content: "*First*\n*Second*\n*Third*" });
    const current = buildConversationArtifacts({ messageId: "u2", role: "user", content: "采用第 3 个标题" });
    const third = prior.filter((artifact) => artifact.kind === "emphasis")[2]!;
    const complete: typeof completeStructured = async <T>(args: Parameters<typeof completeStructured<T>>[0]) => {
      const currentOccurrences = args.messages.filter((message) => message.content === "采用第 3 个标题");
      expect(currentOccurrences).toHaveLength(0);
      const raw = JSON.stringify({
        schemaVersion: "2",
        action: "fill-sections",
        applyMode: "propose-patch",
        contentMode: "provided",
        scope: "targets",
        evidenceMode: "none",
        targets: [{ slot: "title", sourceIds: [third.id] }],
      });
      const parsed = args.parse(raw);
      if (!parsed.ok) return { ok: false as const, message: parsed.message, raw };
      return { ok: true as const, value: parsed.value, raw, repaired: false };
    };
    const interpreted = await interpretTaskSpec({
      config: { mode: "mock" },
      userText: "采用第 3 个标题",
      history: [
        { role: "assistant", content: "*First*\n*Second*\n*Third*" },
      ],
      model: await model(),
      sources: [...prior, ...current],
      complete,
    });
    expect(interpreted.ok).toBe(true);
    if (interpreted.ok) expect(interpreted.spec.targets[0]?.sourceIds).toEqual([third.id]);
  });

  it("returns invalid instead of a safe advice fallback after malformed structured output", async () => {
    const sources = buildConversationArtifacts({ messageId: "u1", role: "user", content: "修改标题为New" });
    const interpreted = await interpretTaskSpec({
      config: { mode: "mock" },
      userText: "修改标题为New",
      history: [],
      model: await model(),
      sources,
      complete: async () => ({ ok: false, message: "invalid after repair", raw: "plain text" }),
    });
    expect(interpreted).toMatchObject({ ok: false, source: "invalid", error: "invalid after repair" });
  });

  it("keeps explicit review and advice actions answer-only", async () => {
    const complete: typeof completeStructured = async <T>(args: Parameters<typeof completeStructured<T>>[0]) => {
      const raw = JSON.stringify({
        schemaVersion: "2",
        action: "review",
        applyMode: "answer-only",
        contentMode: "none",
        scope: "manuscript",
        evidenceMode: "none",
        targets: [],
      });
      const parsed = args.parse(raw);
      if (!parsed.ok) return { ok: false as const, message: parsed.message, raw };
      return { ok: true as const, value: parsed.value as T, raw, repaired: false };
    };
    const interpreted = await interpretTaskSpec({
      config: { mode: "mock" },
      userText: "审阅论文",
      history: [],
      model: await model(),
      sources: [],
      lockedAction: "review",
      complete,
    });
    expect(interpreted.ok).toBe(true);
    if (interpreted.ok) {
      expect(interpreted.spec.action).toBe("review");
      expect(interpreted.spec.applyMode).toBe("answer-only");
    }
  });
});
