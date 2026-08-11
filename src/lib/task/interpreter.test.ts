import { describe, expect, it } from "vitest";
import { buildContextSnapshot } from "../context/snapshot";
import { buildConversationArtifacts } from "../conversationArtifacts";
import { buildManuscriptModel } from "../manuscript/model";
import type { completeStructured } from "../llmClient";
import { interpretTaskSpec, requestsFileCommit, requestsWritingAssistance } from "./interpreter";

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
    expect(requestsFileCommit("帮我写一段摘要")).toBe(false);
    expect(requestsWritingAssistance("帮我写一段摘要")).toBe(true);
    expect(requestsFileCommit("修改标题为A New Title")).toBe(true);
    expect(requestsFileCommit("改写标题为A New Title")).toBe(true);
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

  it("lets the assisted-writing TaskSpec policy decide conversation versus file transaction", async () => {
    const userText = "请帮我写一段摘要";
    const sources = buildConversationArtifacts({ messageId: "u1", role: "user", content: userText });
    let structuredCalled = false;
    const interpreted = await interpretTaskSpec({
      config: { mode: "mock" },
      userText,
      history: [],
      model: await model(),
      sources,
      complete: async <T>(args: Parameters<typeof completeStructured<T>>[0]) => {
        structuredCalled = true;
        const payload = JSON.parse(args.messages.at(-1)?.content ?? "{}");
        expect(payload.authoritativeApplyMode).toBeNull();
        expect(payload.allowedApplyModes).toEqual(["answer-only", "propose-patch"]);
        expect(args.messages[0]?.content).toContain("Assisted writing TaskSpec policy");
        const raw = JSON.stringify({
          schemaVersion: "2",
          action: "draft",
          applyMode: "propose-patch",
          contentMode: "generate",
          scope: "targets",
          evidenceMode: "none",
          targets: [{ slot: "abstract", sourceIds: [] }],
        });
        const parsed = args.parse(raw);
        if (!parsed.ok) return { ok: false as const, message: parsed.message, raw };
        return { ok: true as const, value: parsed.value as T, raw, repaired: false };
      },
    });
    expect(structuredCalled).toBe(true);
    expect(interpreted).toMatchObject({
      ok: true,
      source: "llm",
      spec: {
        action: "draft",
        applyMode: "propose-patch",
        contentMode: "generate",
        targets: [{ slot: "abstract", sourceIds: [] }],
      },
    });
  });

  it("separates source context slots from write targets", async () => {
    const userText = "基于标题写一个引言";
    const sources = buildConversationArtifacts({ messageId: "u1", role: "user", content: userText });
    const interpreted = await interpretTaskSpec({
      config: { mode: "mock" },
      userText,
      history: [],
      model: await model(),
      sources,
      complete: async <T>(args: Parameters<typeof completeStructured<T>>[0]) => {
        expect(args.messages[0]?.content).toContain("Use targets only for slots that will be modified");
        const raw = JSON.stringify({
          schemaVersion: "2",
          action: "draft",
          applyMode: "propose-patch",
          contentMode: "generate",
          scope: "targets",
          evidenceMode: "none",
          targets: [{ slot: "introduction", sourceIds: [] }],
          contextSlots: [{ slot: "title" }],
        });
        const parsed = args.parse(raw);
        if (!parsed.ok) return { ok: false as const, message: parsed.message, raw };
        return { ok: true as const, value: parsed.value as T, raw, repaired: false };
      },
    });
    expect(interpreted).toMatchObject({
      ok: true,
      spec: {
        action: "draft",
        applyMode: "propose-patch",
        targets: [{ slot: "introduction", sourceIds: [] }],
        contextSlots: [{ slot: "title" }],
      },
    });
  });

  it("blocks assisted-writing classification failures instead of silently turning them into chat", async () => {
    const userText = "请帮我补充讨论部分";
    const sources = buildConversationArtifacts({ messageId: "u1", role: "user", content: userText });
    const interpreted = await interpretTaskSpec({
      config: { mode: "mock" },
      userText,
      history: [],
      model: await model(),
      sources,
      complete: async () => ({ ok: false, message: "invalid after repair", raw: "plain text" }),
    });
    expect(interpreted).toMatchObject({ ok: false, source: "invalid", error: "invalid after repair" });
  });

  it("keeps an unresolvable mutation blocked after malformed structured output", async () => {
    const sources = buildConversationArtifacts({ messageId: "u1", role: "user", content: "请修改一下" });
    const interpreted = await interpretTaskSpec({
      config: { mode: "mock" },
      userText: "请修改一下",
      history: [],
      model: await model(),
      sources,
      complete: async () => ({ ok: false, message: "invalid after repair", raw: "plain text" }),
    });
    expect(interpreted).toMatchObject({ ok: false, source: "invalid", error: "invalid after repair" });
  });

  it("recovers an exact title transaction from runtime artifacts when TaskSpec JSON fails", async () => {
    const userText = "修改标题为A Runtime-Owned Title";
    const sources = buildConversationArtifacts({ messageId: "u1", role: "user", content: userText });
    const assignment = sources.find((source) => source.kind === "assignment-value")!;
    const interpreted = await interpretTaskSpec({
      config: { mode: "mock" },
      userText,
      history: [],
      model: await model(),
      sources,
      complete: async () => ({ ok: false, message: "invalid after repair", raw: "plain text" }),
    });
    expect(interpreted).toMatchObject({
      ok: true,
      source: "runtime",
      spec: {
        action: "fill-sections",
        applyMode: "propose-patch",
        targets: [{ slot: "title", sourceIds: [assignment.id] }],
      },
    });
  });

  it("does not replace a failed historical reference with generated prose", async () => {
    const prior = buildConversationArtifacts({ messageId: "a1", role: "assistant", content: "*First*\n*Second*\n*Third*" });
    const current = buildConversationArtifacts({ messageId: "u2", role: "user", content: "采用第 3 个标题" });
    const interpreted = await interpretTaskSpec({
      config: { mode: "mock" },
      userText: "采用第 3 个标题",
      history: [{ role: "assistant", content: "*First*\n*Second*\n*Third*" }],
      model: await model(),
      sources: [...prior, ...current],
      complete: async () => ({ ok: false, message: "invalid after repair", raw: "plain text" }),
    });
    expect(interpreted).toMatchObject({ ok: false, source: "invalid" });
  });

  it("falls back to answer-only conversational polishing when TaskSpec JSON fails", async () => {
    const userText = "英文改写标题：《基于单细胞转录组 NMF 模式与机器学习的肝细胞癌早期筛查标志物识别》";
    const sources = buildConversationArtifacts({ messageId: "u1", role: "user", content: userText });
    const interpreted = await interpretTaskSpec({
      config: { mode: "mock" },
      userText,
      history: [],
      model: await model(),
      sources,
      complete: async () => ({ ok: false, message: "invalid after repair", raw: "plain text" }),
    });
    expect(interpreted).toMatchObject({
      ok: true,
      source: "runtime",
      spec: { action: "polish", applyMode: "answer-only", scope: "manuscript", targets: [] },
    });
  });

  it("answers title brainstorming without invoking the structured interpreter", async () => {
    const userText = "帮我就以下关键词取标题：HCC，NMF，scRNA，early screen，机器学习";
    let structuredCalled = false;
    const interpreted = await interpretTaskSpec({
      config: { mode: "mock" },
      userText,
      history: [],
      model: await model(),
      sources: buildConversationArtifacts({ messageId: "u1", role: "user", content: userText }),
      complete: async () => {
        structuredCalled = true;
        return { ok: false, message: "must not be called", raw: "" };
      },
    });
    expect(interpreted).toMatchObject({
      ok: true,
      source: "runtime",
      spec: { action: "advice", applyMode: "answer-only" },
    });
    expect(structuredCalled).toBe(false);
  });

  it("falls back to manuscript polish for an explicit UI action", async () => {
    const userText = "请润色当前稿件的主要表述，保持科学主张强度不变。";
    const interpreted = await interpretTaskSpec({
      config: { mode: "mock" },
      userText,
      history: [],
      model: await model(),
      sources: buildConversationArtifacts({ messageId: "u1", role: "user", content: userText }),
      lockedAction: "polish",
      complete: async () => ({ ok: false, message: "invalid after repair", raw: "plain text" }),
    });
    expect(interpreted).toMatchObject({
      ok: true,
      source: "runtime",
      spec: { action: "polish", applyMode: "propose-patch", scope: "manuscript", targets: [] },
    });
  });

  it("does not make exploratory rewriting depend on structured model output", async () => {
    const userText = "英文改写标题：《旧标题》";
    let structuredCalled = false;
    const interpreted = await interpretTaskSpec({
      config: { mode: "mock" },
      userText,
      history: [],
      model: await model(),
      sources: buildConversationArtifacts({ messageId: "u1", role: "user", content: userText }),
      complete: async <T>(args: Parameters<typeof completeStructured<T>>[0]) => {
        structuredCalled = true;
        const raw = JSON.stringify({
          schemaVersion: "2",
          action: "polish",
          applyMode: "propose-patch",
          contentMode: "generate",
          scope: "manuscript",
          evidenceMode: "none",
          targets: [],
        });
        const parsed = args.parse(raw);
        if (!parsed.ok) return { ok: false as const, message: parsed.message, raw };
        return { ok: true as const, value: parsed.value, raw, repaired: false };
      },
    });
    expect(interpreted).toMatchObject({
      ok: true,
      source: "runtime",
      spec: { action: "polish", applyMode: "answer-only" },
    });
    expect(structuredCalled).toBe(false);
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
