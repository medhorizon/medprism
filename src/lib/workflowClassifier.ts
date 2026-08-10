import { LLM_CLASSIFIER_HISTORY_MAX } from "./chatHistory";
import { chatCompletions, type ChatRequestMessage, type LlmConfig } from "./llmClient";
import { repairJsonText } from "./replyParse";
import type { WorkflowKind } from "./workflows/types";

/** Closed set the classifier may return. Runtime still builds the WorkflowPlan. */
export const LLM_ROUTEABLE_KINDS = [
  "writing",
  "polish",
  "citation",
  "review",
  "latex",
  "compile-fix",
  "research",
  "advice",
] as const satisfies readonly WorkflowKind[];

export type LlmRouteableKind = (typeof LLM_ROUTEABLE_KINDS)[number];

const KIND_SET = new Set<string>(LLM_ROUTEABLE_KINDS);

const CLASSIFIER_SYSTEM = `You are MedPrism's workflow classifier.
Choose exactly one workflow for the user message from this closed set:
- writing: draft or structurally edit manuscript prose / blank sections / modules
- polish: language-only revision without changing scientific claims
- citation: add or evaluate citations for a claim (requires literature retrieval)
- review: peer-review style critique; advisory only, no file edits
- latex: formatting / structure / venue LaTeX edits without scientific rewriting
- compile-fix: repair a LaTeX compile error
- research: literature survey / evidence synthesis without editing files
- advice: answer a question only; do not edit the manuscript

Return ONLY a JSON object:
{"workflow":"<one of the kinds above>","reason":"short reason"}

Never invent other workflow names.
Prefer advice for pure questions about requirements or process (what is missing / what to prepare) when the user is NOT asking to insert blank shells.
Prefer writing when the user asks to prepare, insert, or fill blank/empty manuscript modules or structure (especially with 内容留空 / empty shells).`;

export type ClassifyWorkflowResult = {
  kind: LlmRouteableKind;
  reason: string;
  source: "llm" | "fallback";
};

function parseClassifierJson(raw: string): { workflow?: string; reason?: string } | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const slice = candidate.slice(start, end + 1);
  for (const text of [slice, repairJsonText(slice)]) {
    try {
      return JSON.parse(text) as {
        workflow?: string;
        reason?: string;
      };
    } catch {
      // try next
    }
  }
  return null;
}

export async function classifyWorkflowKind(args: {
  config: LlmConfig;
  userText: string;
  history?: ChatRequestMessage[];
  signal?: AbortSignal;
  complete?: (messages: ChatRequestMessage[]) => Promise<string>;
}): Promise<ClassifyWorkflowResult> {
  const messages: ChatRequestMessage[] = [
    { role: "system", content: CLASSIFIER_SYSTEM },
    ...((args.history ?? []).slice(-LLM_CLASSIFIER_HISTORY_MAX)),
    {
      role: "user",
      content: args.userText.trim() || "(empty)",
    },
  ];

  try {
    const raw = args.complete
      ? await args.complete(messages)
      : await chatCompletions({
          config: args.config,
          messages,
          stream: false,
          ...(args.signal ? { signal: args.signal } : {}),
        });
    const parsed = parseClassifierJson(raw);
    const workflow = parsed?.workflow?.trim();
    if (workflow && KIND_SET.has(workflow)) {
      return {
        kind: workflow as LlmRouteableKind,
        reason: parsed?.reason?.trim() || "LLM closed-set classification",
        source: "llm",
      };
    }
  } catch {
    // Fall through to safe default.
  }

  return {
    kind: "advice",
    reason: "Classifier unavailable or invalid; default to advice-only",
    source: "fallback",
  };
}
