import { LLM_CLASSIFIER_HISTORY_MAX } from "../chatHistory";
import {
  completeStructured,
  type ChatRequestMessage,
  type LlmConfig,
} from "../llmClient";
import type { ManuscriptModel } from "../manuscript/types";
import { manuscriptInventory } from "../manuscript/model";
import { parseTaskSpec } from "./schema";
import type { ConversationArtifact } from "../../types/chat";
import type { InterpretedTask, TaskAction } from "./types";

const TASK_SYSTEM = `You are MedPrism's semantic task interpreter.
Map the user's natural-language request to exactly one TaskSpec JSON object.
You may only use runtime-provided message segment IDs and semantic manuscript slots.
Never return file paths, source ranges, oldText, newText, anchors, operations, hashes, patches, or PatchSets.

Actions:
- advice: answer only
- draft: generate manuscript prose for named targets
- polish: language-only revision
- scaffold: create blank manuscript structures
- fill-sections: place user-provided segment text without rewriting it
- cite: find literature for manuscript claims and add verified citations
- review/research: advisory only
- latex/compile-fix: structural or diagnostic source repair

Required invariants:
- advice/review/research => applyMode answer-only
- every other action => applyMode propose-patch and an explicit target or selection
- scaffold => propose-patch + blank + evidenceMode none
- fill-sections => propose-patch + provided; it places exact source text into any semantic slot, including title
- cite => propose-patch + literature

Use fill-sections when the user supplies the exact replacement text, including commands such as "change the title to X".
Use draft only when new prose must be generated. Brainstorming, comparison, questions, and requests for candidate titles are advice until the user explicitly asks to apply one.
Targets use sourceIds copied from the supplied runtime artifact catalog. A source may come from the current user message or a prior assistant candidate. Never repeat source text in JSON.

Return JSON only.`;

const COMMIT_SPEECH_RE =
  /(?:修改|替换|更新|写入|插入|填入|采用|使用(?:上面|刚才|第)|用(?:上面|刚才|第|这个|那个)|定稿为|改为|改成|换成|设为|应用(?:这个|上述)|(?:写|撰写|起草|生成|补充|润色).{0,24}(?:摘要|引言|方法|结果|讨论|结论|声明|章节|正文)|change\s+.+\s+to|replace\s+.+\s+with|set\s+.+\s+to|insert\s+.+\s+into|apply\s+(?:this|the)|use\s+(?:the|this|that).+\b(?:title|text|version)|(?:write|draft|generate|polish)\s+.+\b(?:abstract|introduction|methods?|results?|discussion|conclusion|section|manuscript)|write\s+.+\s+into)/i;
const EXPLORATORY_SPEECH_RE =
  /(?:如何|怎么|怎样|有什么建议|只(?:检查|分析|审阅|给建议)|检查但不修改|不(?:要|需|需要|用)(?:修改|改动|写入)|给.*(?:几个|一些).*(?:候选|备选)|帮我.*(?:取|想|拟).*(?:标题|题目)|(?:英文|中文)?改写(?:一下)?(?:这个|以下|上述)?(?:标题|题目)|是否应该|可以吗|without\s+(?:modifying|changing|editing)|do\s+not\s+(?:modify|change|edit)|no\s+(?:file\s+)?changes?|how\s+(?:should|can|do)|what\s+(?:would|should)|suggest|propose\s+(?:some|a few)|ideas?\s+for|rewrite\s+(?:this|the)\s+title)/i;
const ANSWER_ONLY_ACTIONS = new Set<TaskAction>(["advice", "review", "research"]);

/** A generic speech-act guard. It never chooses a target or a physical edit. */
export function requestsFileCommit(text: string): boolean {
  return COMMIT_SPEECH_RE.test(text) && !EXPLORATORY_SPEECH_RE.test(text);
}

export function requestsExploration(text: string): boolean {
  return EXPLORATORY_SPEECH_RE.test(text);
}

function slashAction(text: string): TaskAction | undefined {
  const command = text.trim().match(/^\/(ask|advice|write|draft|polish|cite|review|research|latex|compile-fix)\b/i)?.[1]?.toLowerCase();
  const map: Record<string, TaskAction> = {
    ask: "advice", advice: "advice", write: "draft", draft: "draft",
    polish: "polish", cite: "cite", review: "review", research: "research",
    latex: "latex", "compile-fix": "compile-fix",
  };
  return command ? map[command] : undefined;
}

export function lockedTaskAction(args: {
  userText: string;
  explicitAction?: TaskAction;
}): TaskAction | undefined {
  return args.explicitAction ?? slashAction(args.userText);
}

export async function interpretTaskSpec(args: {
  config: LlmConfig;
  userText: string;
  history: ChatRequestMessage[];
  model: ManuscriptModel;
  sources: ConversationArtifact[];
  selectionAvailable?: boolean;
  lockedAction?: TaskAction;
  signal?: AbortSignal;
  complete?: typeof completeStructured;
}): Promise<InterpretedTask> {
  const sources = args.sources.filter((source) => source.text.trim()).slice(-160);
  const ids = sources.map((source) => source.id);
  const complete = args.complete ?? completeStructured;
  const messages: ChatRequestMessage[] = [
    { role: "system", content: TASK_SYSTEM },
    ...args.history.slice(-LLM_CLASSIFIER_HISTORY_MAX),
    {
      role: "user",
      content: JSON.stringify({
        lockedAction: args.lockedAction ?? null,
        currentUserText: args.userText,
        uiSelectionAvailable: args.selectionAvailable === true,
        sourceArtifacts: sources.map(({ id, messageId, role, kind, text }) => ({ id, messageId, role, kind, text })),
        manuscript: {
          profile: args.model.profile,
          mainFile: args.model.mainFile,
          inventory: manuscriptInventory(args.model),
        },
      }),
    },
  ];

  const result = await complete({
    config: args.config,
    messages,
    parse: (raw) => parseTaskSpec(raw, ids, {
      ...(args.lockedAction ? { lockedAction: args.lockedAction } : {}),
      requireProposePatch: args.lockedAction
        ? !ANSWER_ONLY_ACTIONS.has(args.lockedAction)
        : requestsFileCommit(args.userText),
      requireAnswerOnly: args.lockedAction
        ? ANSWER_ONLY_ACTIONS.has(args.lockedAction)
        : requestsExploration(args.userText),
      selectionAvailable: args.selectionAvailable === true,
    }),
    repairInstruction: "Return a valid TaskSpec schemaVersion 2 matching all invariants and only the supplied source artifact IDs.",
    ...(args.signal ? { signal: args.signal } : {}),
  });
  if (!result.ok) {
    return {
      ok: false,
      sources,
      source: "invalid",
      repaired: true,
      error: result.message,
    };
  }
  return {
    ok: true,
    spec: result.value,
    sources,
    source: args.lockedAction ? "locked" : "llm",
    repaired: result.repaired,
  };
}
