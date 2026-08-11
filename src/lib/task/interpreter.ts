import { LLM_CLASSIFIER_HISTORY_MAX } from "../chatHistory";
import assistedWritingPolicy from "../../../prompts/task/assisted-writing.md?raw";
import {
  completeStructured,
  type ChatRequestMessage,
  type LlmConfig,
  type StructuredCompletionResult,
} from "../llmClient";
import type { ManuscriptModel } from "../manuscript/types";
import { manuscriptInventory } from "../manuscript/model";
import { parseTaskSpec } from "./schema";
import {
  runtimeFallbackTask,
  runtimeTaskPolicy,
} from "./policy";
import type { ConversationArtifact } from "../../types/chat";
import type { InterpretedTask, TaskAction, TaskSpec } from "./types";

const TASK_SYSTEM = `You are MedPrism's semantic task interpreter.
Map the user's natural-language request to exactly one TaskSpec JSON object.
You may only use runtime-provided message segment IDs and semantic manuscript slots.
Never return file paths, source ranges, oldText, newText, anchors, operations, hashes, patches, or PatchSets.

Return exactly this JSON shape (all fields are required):
{
  "schemaVersion": "2",
  "action": "advice | draft | polish | scaffold | fill-sections | cite | review | research | latex | compile-fix",
  "applyMode": "answer-only | propose-patch",
  "contentMode": "none | generate | provided | blank",
  "scope": "selection | targets | active-file | manuscript | compile-log",
  "evidenceMode": "none | literature",
  "targets": [{ "slot": "a supplied semantic slot", "sourceIds": ["supplied artifact id"] }]
}

Actions:
- advice: answer only
- draft: generate manuscript prose, either conversationally or for named file targets
- polish: language-only revision, either conversationally or for file targets
- scaffold: create blank manuscript structures
- fill-sections: place user-provided segment text without rewriting it
- cite: find literature for manuscript claims and add verified citations
- review/research: advisory only
- latex/compile-fix: structural or diagnostic source repair

The runtime may supply authoritativeApplyMode. When it is "answer-only" or "propose-patch", echo it exactly.
When authoritativeApplyMode is null, decide applyMode from the assisted-writing policy below.
The model never grants physical file permission: it only classifies intent, selects semantic slots, and cites runtime source IDs.

Required invariants:
- advice/review/research => applyMode answer-only
- draft/polish may be answer-only for conversational generation or rewriting
- scaffold/fill-sections/cite/latex/compile-fix are file transactions
- propose-patch draft/scaffold/fill-sections/latex require a target or selection
- propose-patch polish may use manuscript scope without enumerating targets
- cite may use manuscript scope without enumerating targets
- scaffold => propose-patch + blank + evidenceMode none
- fill-sections => propose-patch + provided; it places exact source text into any semantic slot, including title
- cite => propose-patch + literature

Use fill-sections when the user supplies the exact replacement text, including commands such as "change the title to X".
Use draft only when new prose must be generated. Brainstorming, comparison, questions, and requests for candidate titles are advice until the user explicitly asks to apply one.
Targets use sourceIds copied from the supplied runtime artifact catalog. A source may come from the current user message or a prior assistant candidate. Never repeat source text in JSON.

${assistedWritingPolicy}

Examples:
- "give me title ideas" => advice + answer-only + manuscript + []
- "rewrite this title in English" => polish + answer-only + manuscript + []
- "change the title to X" => fill-sections + propose-patch + targets + title sourceIds
- "please help draft the abstract" => draft + propose-patch + targets + abstract + []
- locked polish with no selection => polish + propose-patch + manuscript + []

Return JSON only.`;

export { requestsExploration, requestsFileCommit, requestsWritingAssistance } from "./policy";

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
  const policy = runtimeTaskPolicy({
    userText: args.userText,
    ...(args.lockedAction ? { lockedAction: args.lockedAction } : {}),
  });
  if (policy.applyMode === "answer-only" && !policy.allowLlmApplyMode) {
    // Pure conversation must not depend on provider-specific JSON compliance.
    // The downstream answer workflow still receives manuscript context and may stream normally.
    const conversationalTask = runtimeFallbackTask({
      userText: args.userText,
      sources,
      selectionAvailable: args.selectionAvailable === true,
      policy,
      repaired: false,
      ...(args.lockedAction ? { lockedAction: args.lockedAction } : {}),
    });
    if (conversationalTask) return conversationalTask;
  }
  const messages: ChatRequestMessage[] = [
    { role: "system", content: TASK_SYSTEM },
    ...args.history.slice(-LLM_CLASSIFIER_HISTORY_MAX),
    {
      role: "user",
      content: JSON.stringify({
        lockedAction: args.lockedAction ?? null,
        authoritativeApplyMode: policy.allowLlmApplyMode ? null : policy.applyMode,
        allowedApplyModes: policy.allowLlmApplyMode ? ["answer-only", "propose-patch"] : [policy.applyMode],
        permissionReason: policy.reason,
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

  let result: StructuredCompletionResult<TaskSpec>;
  try {
    result = await complete<TaskSpec>({
      config: args.config,
      messages,
      parse: (raw) => parseTaskSpec(raw, ids, {
        ...(args.lockedAction ? { lockedAction: args.lockedAction } : {}),
        ...(policy.allowLlmApplyMode ? {} : { authoritativeApplyMode: policy.applyMode }),
        selectionAvailable: args.selectionAvailable === true,
      }),
      repairInstruction: [
        "Return only a valid TaskSpec schemaVersion 2 JSON object.",
        `action is${args.lockedAction ? ` locked to ${args.lockedAction}` : " selected from the documented enum"}.`,
        policy.allowLlmApplyMode
          ? "applyMode must be either answer-only or propose-patch according to the assisted-writing policy."
          : `applyMode must be ${policy.applyMode}.`,
        `UI selection is ${args.selectionAvailable === true ? "available" : "not available"}.`,
        "Use only supplied source artifact IDs and never return physical file or PatchSet fields.",
      ].join(" "),
      ...(args.signal ? { signal: args.signal } : {}),
    });
  } catch (error) {
    if (policy.allowLlmApplyMode) {
      return {
        ok: false,
        sources,
        source: "invalid",
        repaired: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const fallback = runtimeFallbackTask({
      userText: args.userText,
      sources,
      selectionAvailable: args.selectionAvailable === true,
      policy,
      ...(args.lockedAction ? { lockedAction: args.lockedAction } : {}),
    });
    if (fallback) return fallback;
    return {
      ok: false,
      sources,
      source: "invalid",
      repaired: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!result.ok) {
    if (policy.allowLlmApplyMode) {
      return {
        ok: false,
        sources,
        source: "invalid",
        repaired: true,
        error: result.message,
      };
    }
    const fallback = runtimeFallbackTask({
      userText: args.userText,
      sources,
      selectionAvailable: args.selectionAvailable === true,
      policy,
      ...(args.lockedAction ? { lockedAction: args.lockedAction } : {}),
    });
    if (fallback) return fallback;
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
