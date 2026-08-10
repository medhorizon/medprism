import { LLM_CLASSIFIER_HISTORY_MAX } from "../chatHistory";
import {
  completeStructured,
  type ChatRequestMessage,
  type LlmConfig,
} from "../llmClient";
import type { ManuscriptModel } from "../manuscript/types";
import { manuscriptInventory } from "../manuscript/model";
import { parseTaskSpec, safeAdviceTask } from "./schema";
import { segmentUserMessage } from "./segments";
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
- scaffold => propose-patch + blank + evidenceMode none
- fill-sections => propose-patch + provided
- cite => propose-patch + literature

Return JSON only.`;

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
  lockedAction?: TaskAction;
  signal?: AbortSignal;
  complete?: typeof completeStructured;
}): Promise<InterpretedTask> {
  const segments = segmentUserMessage(args.userText);
  const ids = segments.map((segment) => segment.id);
  const complete = args.complete ?? completeStructured;
  const messages: ChatRequestMessage[] = [
    { role: "system", content: TASK_SYSTEM },
    ...args.history.slice(-LLM_CLASSIFIER_HISTORY_MAX),
    {
      role: "user",
      content: JSON.stringify({
        lockedAction: args.lockedAction ?? null,
        messageSegments: segments.map(({ id, text }) => ({ id, text })),
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
    parse: (raw) => parseTaskSpec(raw, ids, args.lockedAction),
    repairInstruction: "Return a valid TaskSpec matching the documented invariants and only the supplied segment IDs.",
    ...(args.signal ? { signal: args.signal } : {}),
  });
  if (!result.ok) {
    return {
      spec: safeAdviceTask(),
      segments,
      source: "safe-fallback",
      repaired: true,
      warning: result.message,
    };
  }
  return {
    spec: result.value,
    segments,
    source: args.lockedAction ? "locked" : "llm",
    repaired: result.repaired,
  };
}
