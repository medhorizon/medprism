import academicPaperSkill from "../../../skills/academic-paper/SKILL.md?raw";
import latexPaperEnSkill from "../../../skills/latex-paper-en/SKILL.md?raw";
import naturePolishingSkill from "../../../skills/nature-polishing/SKILL.md?raw";
import natureWritingSkill from "../../../skills/nature-writing/SKILL.md?raw";
import scientificWritingSkill from "../../../skills/scientific-writing/SKILL.md?raw";
import {
  buildContextSnapshot,
  formatWorkspaceContext,
  type ContextSnapshot,
} from "../context/snapshot";
import type { ResolvedTask } from "../context/resolver";
import type { ResolvedLatexTarget } from "../latex/types";
import { displayHeading } from "../manuscript/slots";
import { taggedPromptData } from "../promptData";
import { compactPaperHits, validateResearchUse } from "../research/service";
import { parseModelWorkflowEnvelope } from "../replyParse";
import {
  detectWritingDomain,
  isNatureWritingRequest,
} from "../skillRouter";
import { finalizeModelPatchProposal, finalizePatchSet } from "./latexApply";
import { buildWorkflowSystemPrompt } from "./prompt";
import { runTargetedTextWorkflow } from "./textWriting";
import { runSemanticWriting } from "./semanticWriting";
import {
  emptyAgentResult,
  type WorkflowExecutionInput,
  type WorkflowHandler,
  type WorkflowKind,
  type WorkflowResult,
} from "./types";

const WRITING_KINDS = new Set<WorkflowKind>(["writing", "polish", "latex"]);

function latexKindForResolved(ref: ResolvedTask["targets"][number]["ref"]): ResolvedLatexTarget["kind"] {
  if (ref.slot === "custom-section") return "section";
  if (ref.slot === "competing-interests") return "conflict-of-interest";
  if ([
    "title", "abstract", "keywords", "introduction", "methods", "results", "discussion",
    "conclusion", "funding", "acknowledgements", "author-contributions", "data-availability",
    "ethics", "body",
  ].includes(ref.slot)) return ref.slot as ResolvedLatexTarget["kind"];
  return "section";
}

function resolvedTextTarget(
  snapshot: ContextSnapshot,
  resolved: ResolvedTask,
): { ok: true; target: ResolvedLatexTarget } | { ok: false; message: string } {
  if (resolved.selection) {
    return {
      ok: true,
      target: {
        kind: "selection",
        path: resolved.selection.path,
        mode: "replace_body",
        syntax: "selection",
        existingText: resolved.selection.text,
        sourceContext: snapshot.localContext,
        range: resolved.selection.range,
      },
    };
  }
  if (resolved.targets.length !== 1) {
    return { ok: false, message: "Generated or polished prose requires exactly one resolved semantic target." };
  }
  const binding = resolved.targets[0]!;
  const kind = latexKindForResolved(binding.ref);
  if (binding.occurrence) {
    const occurrence = binding.occurrence;
    const source = snapshot.files[occurrence.path] ?? "";
    const center = occurrence.wrapperRange.start;
    return {
      ok: true,
      target: {
        kind,
        path: occurrence.path,
        mode: "replace_body",
        syntax: occurrence.syntax === "declaration-item" ? "section" : occurrence.syntax,
        existingText: occurrence.body,
        sourceContext: source.slice(Math.max(0, center - 1000), Math.min(source.length, occurrence.wrapperRange.end + 1000)),
        range: occurrence.bodyRange,
        heading: occurrence.heading,
        ...(kind === "title" || kind === "keywords" ? { commandName: kind } : {}),
      },
    };
  }
  if (binding.insertion) {
    const insertion = binding.insertion;
    const source = snapshot.files[insertion.path];
    if (source === undefined || insertion.at >= source.length) {
      return { ok: false, message: "The semantic insertion point is no longer available." };
    }
    const end = Math.min(source.length, insertion.at + 120);
    return {
      ok: true,
      target: {
        kind,
        path: insertion.path,
        mode: "insert_before",
        syntax: insertion.syntax === "declaration-item" ? "section" : insertion.syntax,
        existingText: "",
        sourceContext: source.slice(Math.max(0, insertion.at - 1000), Math.min(source.length, end + 1000)),
        range: { start: insertion.at, end },
        anchor: source.slice(insertion.at, end),
        heading: displayHeading(binding.ref),
        ...(kind === "title" || kind === "keywords" ? { commandName: kind } : {}),
      },
    };
  }
  return { ok: false, message: "The semantic text target could not be resolved." };
}

function resolvedTextTargets(
  snapshot: ContextSnapshot,
  resolved: ResolvedTask,
): { ok: true; targets: ResolvedLatexTarget[] } | { ok: false; message: string } {
  if (resolved.selection) {
    const target = resolvedTextTarget(snapshot, resolved);
    return target.ok ? { ok: true, targets: [target.target] } : target;
  }
  if (resolved.targets.length === 0) {
    return { ok: false, message: "Generated or polished prose requires at least one resolved semantic target." };
  }
  const targets: ResolvedLatexTarget[] = [];
  for (const binding of resolved.targets) {
    const target = resolvedTextTarget(snapshot, { ...resolved, targets: [binding] });
    if (!target.ok) return target;
    targets.push(target.target);
  }
  return { ok: true, targets };
}

async function runAtomicTargetedTextWorkflow(args: {
  input: WorkflowExecutionInput;
  snapshot: ContextSnapshot;
  skill: ReturnType<typeof selectedWritingSkill>;
  targets: ResolvedLatexTarget[];
}): Promise<WorkflowResult> {
  if (args.targets.length === 1) {
    return runTargetedTextWorkflow({
      input: args.input,
      snapshot: args.snapshot,
      skill: args.skill,
      resolvedTarget: args.targets[0]!,
    });
  }

  const results: WorkflowResult[] = [];
  for (const target of args.targets) {
    const result = await runTargetedTextWorkflow({
      input: args.input,
      snapshot: args.snapshot,
      skill: args.skill,
      resolvedTarget: target,
    });
    if (!result.agent.patch) {
      return invalidModelResult(
        args.input.request.kind,
        result.agent.warnings.join(" ") || `No safe draft was produced for ${target.heading ?? target.kind}.`,
      );
    }
    results.push(result);
  }

  const operations = results
    .flatMap((result) => result.agent.patch!.operations)
    .sort((left, right) => {
      const byPath = left.path.localeCompare(right.path);
      if (byPath !== 0) return byPath;
      const leftStart = left.op === "replace_text" ? left.range?.start ?? -1 : -1;
      const rightStart = right.op === "replace_text" ? right.range?.start ?? -1 : -1;
      return rightStart - leftStart;
    });
  const operationLabel = args.input.request.kind === "polish" ? "Polish" : "Write";
  const patchSet = {
    schemaVersion: "1" as const,
    id: crypto.randomUUID(),
    projectRevision: args.snapshot.projectRevision,
    summary: `${operationLabel} ${args.targets.length} manuscript sections atomically`,
    operations,
    verify: { compile: true },
  };
  const finalized = await finalizePatchSet(args.snapshot, patchSet);
  if (!finalized.ok) {
    return invalidModelResult(args.input.request.kind, finalized.error.message);
  }
  return {
    agent: {
      schemaVersion: "1",
      workflow: args.input.request.kind,
      summary: patchSet.summary,
      warnings: results.flatMap((result) => result.agent.warnings),
      patch: finalized.patchSet,
    },
    content: `Prepared one atomic manuscript transaction covering ${args.targets.length} semantic sections. Review the combined Diff before choosing Keep.`,
    toolNotes: [
      `workflow:${args.input.request.kind}:multi-target`,
      `targets:${args.targets.length}`,
      `skill:${args.skill.id}`,
      ...results.flatMap((result) => result.toolNotes),
    ],
  };
}

function projectHint(input: WorkflowExecutionInput): string {
  const path = input.ctx.activeFile ?? input.ctx.mainFile ?? Object.keys(input.ctx.files)[0];
  return path ? (input.ctx.files[path] ?? "").slice(0, 2000) : "";
}

export function selectedWritingSkill(input: WorkflowExecutionInput): {
  id: string;
  text: string;
} {
  if (input.request.kind === "polish") {
    return { id: "nature-polishing", text: naturePolishingSkill };
  }
  if (input.request.kind === "latex") {
    return { id: "latex-paper-en", text: latexPaperEnSkill };
  }
  if (isNatureWritingRequest(input.request.userText)) {
    return { id: "nature-writing", text: natureWritingSkill };
  }
  return detectWritingDomain(input.request.userText, projectHint(input)) === "general"
    ? { id: "academic-paper", text: academicPaperSkill }
    : { id: "scientific-writing", text: scientificWritingSkill };
}

function invalidModelResult(
  kind: WorkflowKind,
  message: string,
): WorkflowResult {
  return {
    agent: emptyAgentResult(kind, "Structured model result was rejected", [message]),
    content: `模型结果未通过安全验证，未生成可 Keep 的修改：${message}`,
    toolNotes: [`model-result-rejected:${message}`],
  };
}

export const runWritingWorkflow: WorkflowHandler = async (input) => {
  const kind = input.request.kind;
  if (!WRITING_KINDS.has(kind)) {
    return invalidModelResult(kind, `Writing handler cannot execute ${kind}`);
  }

  let snapshot: ContextSnapshot;
  try {
    snapshot = await buildContextSnapshot(input.ctx);
  } catch (error) {
    return invalidModelResult(
      kind,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (input.request.resolvedTask) {
    const semantic = await runSemanticWriting(snapshot, input.request.resolvedTask);
    if (semantic) return semantic;
  }
  const skill = selectedWritingSkill(input);
  if (
    input.request.resolvedTask &&
    (input.request.resolvedTask.spec.action === "draft" || input.request.resolvedTask.spec.action === "polish")
  ) {
    const targets = resolvedTextTargets(snapshot, input.request.resolvedTask);
    if (!targets.ok) return invalidModelResult(kind, targets.message);
    return runAtomicTargetedTextWorkflow({ input, snapshot, skill, targets: targets.targets });
  }
  const target = input.request.plan?.target;

  // All runtime-locatable prose targets use the same trusted LaTeX adapter.
  if ((kind === "writing" || kind === "polish") && target) {
    return runTargetedTextWorkflow({ input, snapshot, skill, targetSpec: target });
  }

  const system = buildWorkflowSystemPrompt({
    workflow: kind,
    skillId: skill.id,
    skill: skill.text,
    capabilities: [
      ...(input.research ? ["research" as const] : []),
      "latex-output",
    ],
  });
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: formatWorkspaceContext(snapshot) },
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
    ...input.history.slice(-10),
    {
      role: "user" as const,
      content: taggedPromptData("user_request", "", { text: input.request.userText }),
    },
  ];
  const raw = await input.services.complete({ config: input.config, messages });
  const parsed = parseModelWorkflowEnvelope(raw, kind);
  if (!parsed.ok) return invalidModelResult(kind, parsed.error.message);
  if (
    parsed.envelope.textDraftValue !== undefined ||
    parsed.envelope.citationPlanValue !== undefined ||
    parsed.envelope.researchReportValue !== undefined ||
    parsed.envelope.reviewValue !== undefined
  ) {
    return invalidModelResult(
      kind,
      `${kind} workflow returned a payload owned by another workflow or requires a runtime target`,
    );
  }

  if (input.research && parsed.envelope.proposal) {
    if (parsed.envelope.researchUseValue === undefined) {
      return invalidModelResult(
        kind,
        "Research-assisted source edits must declare researchUse.sourceCandidateIds",
      );
    }
    const use = validateResearchUse(
      parsed.envelope.researchUseValue,
      input.research,
      true,
    );
    if (!use.ok) return invalidModelResult(kind, use.message);
  } else if (!input.research && parsed.envelope.researchUseValue !== undefined) {
    return invalidModelResult(
      kind,
      "A non-research workflow must not claim trusted research candidates",
    );
  }

  const proposal = parsed.envelope.proposal;
  if (!proposal) {
    return {
      agent: emptyAgentResult(kind, parsed.envelope.summary, [
        ...parsed.envelope.warnings,
        ...(input.research?.warnings ?? []),
      ]),
      content: parsed.envelope.content || parsed.envelope.summary,
      toolNotes: [
        `workflow:${kind}:no-patch`,
        `skill:${skill.id}`,
        ...(input.research
          ? [`research:${input.research.query}:${input.research.hits.length}`]
          : []),
      ],
    };
  }

  const allowedPaths = kind === "latex" && snapshot.mainFile && !snapshot.selection
    ? [...new Set([snapshot.activeFile, snapshot.mainFile])]
    : [snapshot.activeFile];
  const finalized = await finalizeModelPatchProposal({
    snapshot,
    proposal,
    strictSelection: Boolean(snapshot.selection),
    allowedPaths,
    forceCompileVerification: kind === "latex",
  });
  if (!finalized.ok) return invalidModelResult(kind, finalized.error.message);

  return {
    agent: {
      schemaVersion: "1",
      workflow: kind,
      summary: parsed.envelope.summary,
      warnings: [...parsed.envelope.warnings, ...(input.research?.warnings ?? [])],
      patch: finalized.patchSet,
    },
    content: parsed.envelope.content || parsed.envelope.summary,
    toolNotes: [
      `workflow:${kind}`,
      `skill:${skill.id}`,
      ...(input.research
        ? [`research:${input.research.query}:${input.research.hits.length}`]
        : []),
    ],
  };
};
