import fixCompileSkill from "../../../skills/staged/fix-compile-errors/SKILL.md?raw";
import { formatWorkspaceContext, type ContextSnapshot } from "../context/snapshot";
import { parseModelPatchProposal, type ModelPatchProposal, type PatchSet, type SourceRange } from "../patch/schema";
import { parseModelWorkflowEnvelope } from "../replyParse";
import { taggedPromptData } from "../promptData";
import { compileLogNeedsSourceFix } from "../../tools/parseCompileLog";
import type { CompileLogError } from "../../tools/types";
import { finalizeModelPatchProposal } from "./latexApply";
import { buildWorkflowSystemPrompt } from "./prompt";
import { emptyAgentResult, type WorkflowHandler, type WorkflowResult } from "./types";

export type CompileFixPreparation =
  | {
      ok: true;
      diagnostic: CompileLogError;
      path: string;
      sourceContext: string;
      sourceRange: SourceRange;
      prompt: string;
    }
  | { ok: false; code: "NO_ROOT_ERROR" | "INSUFFICIENT_CONTEXT"; message: string };

function sourceWindow(content: string, line: number, radius = 12): {
  text: string;
  range: SourceRange;
} {
  const lines = content.split(/\r\n|\n|\r/);
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\r") {
      if (content[index + 1] === "\n") index += 1;
      starts.push(index + 1);
    } else if (content[index] === "\n") {
      starts.push(index + 1);
    }
  }

  const startLine = Math.max(0, line - 1 - radius);
  const endLine = Math.min(lines.length, line + radius);
  const start = starts[startLine] ?? content.length;
  const end = starts[endLine] ?? content.length;
  return {
    range: { start, end },
    text: lines
      .slice(startLine, endLine)
      .map((value, index) => `${startLine + index + 1}: ${value}`)
      .join("\n"),
  };
}

function indexesWithin(content: string, needle: string, range: SourceRange): number[] {
  if (!needle) return [];
  const indexes: number[] = [];
  let cursor = range.start;
  while (cursor <= range.end - needle.length) {
    const index = content.indexOf(needle, cursor);
    if (index < 0 || index + needle.length > range.end) break;
    indexes.push(index);
    cursor = index + 1;
  }
  return indexes;
}

export function prepareCompileFix(
  snapshot: ContextSnapshot,
  diagnostic: CompileLogError | undefined,
): CompileFixPreparation {
  if (!diagnostic || diagnostic.severity !== "error") {
    return { ok: false, code: "NO_ROOT_ERROR", message: "No root compilation error was found" };
  }
  if (!diagnostic.file || !diagnostic.line) {
    return {
      ok: false,
      code: "INSUFFICIENT_CONTEXT",
      message: "The compiler log did not identify a safe file and line",
    };
  }
  const source = snapshot.files[diagnostic.file];
  if (source === undefined) {
    return {
      ok: false,
      code: "INSUFFICIENT_CONTEXT",
      message: `The diagnosed file is not present in the project: ${diagnostic.file}`,
    };
  }
  const window = sourceWindow(source, diagnostic.line);
  return {
    ok: true,
    diagnostic,
    path: diagnostic.file,
    sourceContext: window.text,
    sourceRange: window.range,
    prompt: [
      taggedPromptData(
        "trusted_tool_results",
        'source="compile"',
        { rootDiagnostic: diagnostic },
      ),
      taggedPromptData(
        "workspace_context",
        'trust="untrusted-data"',
        { targetFile: diagnostic.file, sourceAroundError: window.text },
      ),
      taggedPromptData(
        "user_request",
        "",
        { text: "Repair exactly this one root LaTeX error with one minimal replace_text proposal." },
      ),
    ].join("\n\n"),
  };
}

export async function compileFixProposalToPatch(args: {
  rawProposal: unknown;
  snapshot: ContextSnapshot;
  diagnostic: CompileLogError;
}): Promise<
  | { ok: true; patchSet: PatchSet }
  | { ok: false; code: string; message: string }
> {
  const path = args.diagnostic.file;
  const line = args.diagnostic.line;
  if (!path || !line) {
    return { ok: false, code: "INSUFFICIENT_CONTEXT", message: "Diagnostic path or line is missing" };
  }
  const source = args.snapshot.files[path];
  if (source === undefined) {
    return { ok: false, code: "INSUFFICIENT_CONTEXT", message: `Diagnosed file is missing: ${path}` };
  }

  const parsed = parseModelPatchProposal(args.rawProposal);
  if (!parsed.ok) return { ok: false, code: parsed.error.code, message: parsed.error.message };
  if (parsed.proposal.operations.length !== 1 || parsed.proposal.operations[0]?.op !== "replace_text") {
    return {
      ok: false,
      code: "INVALID_OPERATION",
      message: "Compile-fix must contain exactly one replace_text operation",
    };
  }
  const operation = parsed.proposal.operations[0];
  if (operation.path !== undefined && operation.path !== path) {
    return {
      ok: false,
      code: "UNSAFE_PATH",
      message: `Compile-fix may only edit the diagnosed file: ${path}`,
    };
  }

  const window = sourceWindow(source, line);
  const matches = indexesWithin(source, operation.oldText, window.range);
  if (matches.length !== 1) {
    return {
      ok: false,
      code: "INSUFFICIENT_CONTEXT",
      message: `oldText must match exactly once inside the diagnosed source window; matched ${matches.length}`,
    };
  }
  const selection = { start: matches[0]!, end: matches[0]! + operation.oldText.length };
  const scopedSnapshot: ContextSnapshot = {
    ...args.snapshot,
    activeFile: path,
    selection,
    selectedText: operation.oldText,
  };
  const proposal: ModelPatchProposal = {
    ...parsed.proposal,
    operations: [{ ...operation, path }],
  };
  const finalized = await finalizeModelPatchProposal({
    snapshot: scopedSnapshot,
    proposal,
    allowedPaths: [path],
    strictSelection: true,
    forceCompileVerification: true,
  });
  if (!finalized.ok) {
    return { ok: false, code: finalized.error.code, message: finalized.error.message };
  }
  return { ok: true, patchSet: finalized.patchSet };
}


function isCompileToolPayload(value: unknown): value is {
  compileOk: boolean;
  log: string;
  pdfBase64?: string;
  error?: string;
  code?: string;
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.compileOk === "boolean" && typeof record.log === "string";
}

function engineUnavailableMessage(log: string, error?: string, code?: string): string | undefined {
  const combined = `${code ?? ""}\n${error ?? ""}\n${log}`;
  if (
    code === "ENGINE_UNAVAILABLE" ||
    /Failed to start Tectonic/i.test(combined) ||
    /spawn .*tectonic/i.test(combined)
  ) {
    return [
      "未找到本地 Tectonic 编译引擎，因此无法编译或定位 LaTeX 错误。",
      "请安装 Tectonic 并确保 `tectonic` 在 PATH 中，或设置环境变量 MEDPRISM_TECTONIC_PATH。",
      "说明见 docs/compile-setup.md。未猜测或修改任何文件。",
    ].join(" ");
  }
  return undefined;
}

function invalidCompileFixResult(
  message: string,
  content = "",
  lastCompileLog?: string,
): WorkflowResult {
  return {
    agent: emptyAgentResult(
      "compile-fix",
      "Compile-fix workflow did not produce an applicable patch",
      [message],
    ),
    content: content || message,
    toolNotes: [],
    ...(lastCompileLog !== undefined ? { lastCompileLog } : {}),
  };
}

function compileFixRetryPrompt(error: string): string {
  return taggedPromptData("runtime_rejection", "", {
    error,
    instruction:
      "The previous result could not be applied. Return one JSON envelope for the same compile-fix request. Repair source errors only; do not change Overfull/Underfull or other warnings. patchProposal.operations may only use replace_text, insert_before, or insert_after. Copy oldText or insert anchors verbatim from the supplied LaTeX.",
  });
}

function latexPaths(snapshot: ContextSnapshot): string[] {
  const paths = snapshot.fileTree
    .filter((file) => file.kind === "tex" || file.kind === "bib")
    .map((file) => file.path);
  return paths.length ? paths : [snapshot.activeFile];
}

export const runCompileFixWorkflow: WorkflowHandler = async (input) => {
  const snapshot: ContextSnapshot = input.contextPackage;
  const existingLog = snapshot.compile.log;
  const compiled = existingLog
    ? {
        ok: true as const,
        data: {
          compileOk: !compileLogNeedsSourceFix(existingLog),
          log: existingLog,
        },
      }
    : await input.services.runTool("compile", {}, input.ctx);
  if (!compiled.ok) {
    return invalidCompileFixResult(`编译失败：${compiled.error}`);
  }
  if (!isCompileToolPayload(compiled.data)) {
    return invalidCompileFixResult("编译工具返回了无效结构。");
  }

  const { compileOk, log } = compiled.data;
  if (compileOk || !compileLogNeedsSourceFix(log)) {
    return {
      agent: emptyAgentResult("compile-fix", "No source error to repair", []),
      content: compileOk
        ? "当前项目编译成功。警告（如 Overfull/Underfull）无需修改源码。"
        : "当前编译日志只有警告，无需修改源码。",
      toolNotes: ["compile:success"],
      lastCompileLog: log,
      ...(compiled.data.pdfBase64 ? { pdfBase64: compiled.data.pdfBase64 } : {}),
    };
  }
  const engineMessage = engineUnavailableMessage(log, compiled.data.error, compiled.data.code);
  if (engineMessage) {
    return invalidCompileFixResult(engineMessage, "", log);
  }
  if (!log.trim()) {
    return invalidCompileFixResult(
      compiled.data.error || "编译失败，但没有可用于修复的日志。",
      "",
      log,
    );
  }

  const messages = [
    {
      role: "system" as const,
      content: buildWorkflowSystemPrompt({
        workflow: "compile-fix",
        skillId: "fix-compile-errors",
        skill: fixCompileSkill,
        capabilities: ["latex-output"],
      }),
    },
    { role: "user" as const, content: formatWorkspaceContext(snapshot) },
    {
      role: "user" as const,
      content: taggedPromptData("trusted_tool_results", 'source="compile"', { log }),
    },
    {
      role: "user" as const,
      content: taggedPromptData("user_request", "", {
        text: input.request.userText || "Repair the source error in this compile log. Do not modify warnings.",
      }),
    },
  ];

  const applyRaw = async (raw: string): Promise<
    | { status: "ok"; result: WorkflowResult }
    | { status: "unusable-json"; error: string; content: string }
  > => {
    const parsed = parseModelWorkflowEnvelope(raw, "compile-fix");
    if (!parsed.ok) {
      return { status: "unusable-json", error: parsed.error.message, content: parsed.rawContent };
    }
    if (parsed.envelope.citationPlanValue !== undefined || parsed.envelope.reviewValue !== undefined) {
      return {
        status: "unusable-json",
        error: "Compile-fix returned a payload owned by another workflow",
        content: parsed.envelope.content,
      };
    }
    if (!parsed.envelope.proposal) {
      return {
        status: "ok",
        result: {
          agent: emptyAgentResult(
            "compile-fix",
            parsed.envelope.summary,
            parsed.envelope.warnings,
          ),
          content:
            parsed.envelope.content
            || parsed.envelope.warnings.join(" ")
            || "模型没有提供可验证的修复补丁。",
          toolNotes: ["compile:failed", "skill:fix-compile-errors"],
          lastCompileLog: log,
        },
      };
    }
    const finalized = await finalizeModelPatchProposal({
      snapshot,
      proposal: parsed.envelope.proposal,
      strictSelection: false,
      allowedPaths: latexPaths(snapshot),
      forceCompileVerification: true,
    });
    if (!finalized.ok) {
      return {
        status: "ok",
        result: invalidCompileFixResult(finalized.error.message, parsed.envelope.content, log),
      };
    }
    return {
      status: "ok",
      result: {
        agent: {
          schemaVersion: "1",
          workflow: "compile-fix",
          summary: parsed.envelope.summary,
          warnings: parsed.envelope.warnings,
          patch: finalized.patchSet,
        },
        content: parsed.envelope.content || "已根据编译日志生成修复补丁。Keep 后会再编译一次。",
        toolNotes: ["compile:failed", "skill:fix-compile-errors"],
        lastCompileLog: log,
      },
    };
  };

  const raw = await input.services.complete({ config: input.config, messages });
  const first = await applyRaw(raw);
  if (first.status === "ok") return first.result;

  const retriedRaw = await input.services.complete({
    config: input.config,
    messages: [
      ...messages,
      { role: "assistant", content: raw },
      { role: "user", content: compileFixRetryPrompt(first.error) },
    ],
  });
  const second = await applyRaw(retriedRaw);
  if (second.status === "unusable-json") {
    return invalidCompileFixResult(second.error, second.content, log);
  }
  return {
    ...second.result,
    toolNotes: [...second.result.toolNotes, "model-result-retried"],
  };
};
