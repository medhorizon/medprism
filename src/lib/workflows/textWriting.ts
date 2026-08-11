import targetedTextInstruction from "../../../prompts/workflows/targeted-text.md?raw";
import type { ContextSnapshot } from "../context/snapshot";
import { resolveLatexTarget } from "../latex/textTargets";
import type { LatexTargetSpec } from "../latex/types";
import type { ResolvedLatexTarget } from "../latex/types";
import { taggedPromptData } from "../promptData";
import { compactPaperHits, validateResearchUse } from "../research/service";
import { parseModelWorkflowEnvelope } from "../replyParse";
import { finalizeResolvedTextDraft } from "./latexApply";
import { buildWorkflowSystemPrompt } from "./prompt";
import { validateProtectedTextReplacement } from "./textSafety";
import {
  emptyAgentResult,
  type TextDraft,
  type WorkflowExecutionInput,
  type WorkflowResult,
} from "./types";

export type WritingSkillSelection = {
  id: string;
  text: string;
};

function invalidTargetedTextResult(
  workflow: "writing" | "polish",
  message: string,
): WorkflowResult {
  return {
    agent: emptyAgentResult(
      workflow,
      "The targeted text request could not be applied safely",
      [message],
    ),
    content: `暂时无法安全生成可应用的文本修改：${message}`,
    toolNotes: [`targeted-text:error:${message}`],
  };
}

/** Parse model-owned prose only. Paths, wrappers, hashes and PatchSets remain runtime-owned. */
export function parseTextDraft(
  value: unknown,
  input: {
    workflow: "writing" | "polish";
    hasResearch: boolean;
    research?: WorkflowExecutionInput["research"];
  },
): { ok: true; draft: TextDraft } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "textDraft must be an object" };
  }
  const record = value as Record<string, unknown>;
  const allowedFields = new Set(["text", "format", "sourceCandidateIds"]);
  const unexpected = Object.keys(record).find((field) => !allowedFields.has(field));
  if (unexpected) {
    return { ok: false, message: `textDraft contains an unsupported field: ${unexpected}` };
  }
  if (typeof record.text !== "string" || !record.text.trim()) {
    return { ok: false, message: "textDraft.text is required" };
  }
  if (record.text.length > 80_000) {
    return { ok: false, message: "textDraft.text exceeds the safe length" };
  }
  if (record.format !== "plain-text" && record.format !== "latex-body") {
    return { ok: false, message: "textDraft.format must be plain-text or latex-body" };
  }
  if (/```/.test(record.text)) {
    return { ok: false, message: "textDraft.text must not contain code fences" };
  }
  if (
    input.workflow === "writing" &&
    (/\\cite\w*\s*(?:\[[^\]]*\]\s*)*\{/.test(record.text) ||
      /\bPMID\s*:?\s*\d+\b|\bDOI\s*:?\s*10\.\d{4,9}\//i.test(record.text))
  ) {
    return {
      ok: false,
      message: "Writing drafts must not generate citation commands, DOI, or PMID; use the citation workflow",
    };
  }
  if (
    record.format === "plain-text" &&
    /\\(?:documentclass|usepackage|begin|end|section|subsection|abstract|title|keywords|input|include|bibliography|addbibresource)\b/i.test(record.text)
  ) {
    return {
      ok: false,
      message: "plain-text drafts must contain target prose only, without structural LaTeX",
    };
  }
  if (
    !Array.isArray(record.sourceCandidateIds) ||
    record.sourceCandidateIds.some((candidateId) => typeof candidateId !== "string")
  ) {
    return { ok: false, message: "textDraft.sourceCandidateIds must be a string array" };
  }

  const sourceCandidateIds = [...new Set(record.sourceCandidateIds as string[])];
  if (input.hasResearch) {
    if (!input.research) {
      return { ok: false, message: "Trusted research context is missing" };
    }
    const validated = validateResearchUse(
      { sourceCandidateIds },
      input.research,
      true,
    );
    if (!validated.ok) return validated;
  } else if (sourceCandidateIds.length > 0) {
    return {
      ok: false,
      message: "A non-research text draft must not claim trusted source candidates",
    };
  }

  return {
    ok: true,
    draft: {
      text: record.text.trim(),
      format: record.format,
      sourceCandidateIds,
    },
  };
}

/**
 * One shared target-aware text workflow for Abstract, Methods, Discussion,
 * Funding, any known/custom section, the document body, or an exact selection.
 */
export async function runTargetedTextWorkflow(args: {
  input: WorkflowExecutionInput;
  snapshot: ContextSnapshot;
  skill: WritingSkillSelection;
  targetSpec?: LatexTargetSpec;
  resolvedTarget?: ResolvedLatexTarget;
}): Promise<WorkflowResult> {
  const { input, snapshot, skill } = args;
  if (input.request.kind !== "writing" && input.request.kind !== "polish") {
    return invalidTargetedTextResult(
      "writing",
      `Targeted text workflow cannot execute ${input.request.kind}`,
    );
  }
  const workflow = input.request.kind;
  const targetResult = args.resolvedTarget
    ? { ok: true as const, target: args.resolvedTarget }
    : args.targetSpec
      ? resolveLatexTarget(snapshot, args.targetSpec)
      : { ok: false as const, message: "Resolved semantic text target is missing" };
  if (!targetResult.ok) return invalidTargetedTextResult(workflow, targetResult.message);
  const target = targetResult.target;
  const hasResearch = Boolean(input.research);

  const messages = [
    {
      role: "system" as const,
      content: buildWorkflowSystemPrompt({
        workflow,
        skillId: skill.id,
        skill: skill.text,
        instruction: targetedTextInstruction,
        capabilities: [
          ...(hasResearch ? ["research" as const] : []),
          "latex-output" as const,
        ],
      }),
    },
    {
      role: "user" as const,
      content: taggedPromptData(
        "workspace_context",
        'trust="untrusted-data"',
        {
          activeFile: snapshot.activeFile,
          textTarget: {
            kind: target.kind,
            path: target.path,
            syntax: target.syntax,
            heading: target.heading ?? null,
            existingText: target.existingText.slice(0, 12_000),
            sourceContext: target.sourceContext.slice(0, 16_000),
            preferredFormat:
              /\\[A-Za-z@]+|\$|\\\(|\\\[/.test(target.existingText)
                ? "latex-body"
                : "plain-text",
          },
        },
      ),
    },
    ...(input.research
      ? [{
          role: "user" as const,
          content: taggedPromptData(
            "trusted_tool_results",
            'source="paper_search"',
            {
              query: input.research.query,
              purpose: input.research.purpose,
              candidates: compactPaperHits(input.research.hits),
            },
          ),
        }]
      : []),
    ...input.history.slice(-6),
    {
      role: "user" as const,
      content: taggedPromptData("user_request", "", {
        text: input.request.userText,
        workflow,
        target: {
          kind: target.kind,
          heading: target.heading ?? null,
          mode: target.mode,
        },
      }),
    },
  ];

  const raw = await input.services.complete({ config: input.config, messages });
  const parsed = parseModelWorkflowEnvelope(raw, workflow);
  if (!parsed.ok) return invalidTargetedTextResult(workflow, parsed.error.message);
  if (
    parsed.envelope.proposal ||
    parsed.envelope.citationPlanValue !== undefined ||
    parsed.envelope.researchReportValue !== undefined ||
    parsed.envelope.reviewValue !== undefined
  ) {
    return invalidTargetedTextResult(
      workflow,
      "A runtime-located target must return textDraft, not a model-owned file edit or another workflow payload",
    );
  }
  if (parsed.envelope.textDraftValue === undefined) {
    const explanation = parsed.envelope.content || "模型没有生成可应用的目标文本。";
    return {
      agent: emptyAgentResult(workflow, parsed.envelope.summary, parsed.envelope.warnings),
      content: explanation,
      toolNotes: ["targeted-text:no-draft"],
    };
  }

  const draftResult = parseTextDraft(parsed.envelope.textDraftValue, {
    workflow,
    hasResearch,
    ...(input.research ? { research: input.research } : {}),
  });
  if (!draftResult.ok) return invalidTargetedTextResult(workflow, draftResult.message);

  if (workflow === "polish" && target.existingText) {
    const protectedResult = validateProtectedTextReplacement(
      target.existingText,
      draftResult.draft.text,
    );
    if (!protectedResult.ok) {
      return invalidTargetedTextResult(workflow, protectedResult.message);
    }
  }

  const finalized = await finalizeResolvedTextDraft({
    snapshot,
    target,
    text: draftResult.draft.text,
    format: draftResult.draft.format,
    summary: `${workflow === "polish" ? "Polish" : "Write"} ${target.kind} in ${target.path}`,
  });
  if (!finalized.ok) {
    return invalidTargetedTextResult(workflow, finalized.error.message);
  }

  const researchNote = input.research
    ? `已使用 ${draftResult.draft.sourceCandidateIds.length} 条可信检索候选。`
    : "本次未执行外部文献检索。";
  return {
    agent: {
      schemaVersion: "1",
      workflow,
      summary: parsed.envelope.summary,
      warnings: [...parsed.envelope.warnings, ...(input.research?.warnings ?? [])],
      patch: finalized.patchSet,
    },
    content: `${finalized.plainText ?? draftResult.draft.text}\n\n${researchNote} 已准备写入 ${target.path}，请查看下方 Diff 后选择 Keep。`,
    toolNotes: [
      `workflow:${workflow}:targeted-text`,
      `latex-target:${target.kind}:${target.path}`,
      `skill:${skill.id}`,
      ...(input.research
        ? [`research:${input.research.query}:${input.research.hits.length}`]
        : []),
    ],
  };
}
