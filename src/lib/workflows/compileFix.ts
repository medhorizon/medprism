import fixCompileSkill from "../../../skills/fix-compile-errors/SKILL.md?raw";
import { buildContextSnapshot, type ContextSnapshot } from "../context/snapshot";
import { parseModelPatchProposal, type ModelPatchProposal, type PatchSet, type SourceRange } from "../patch/schema";
import { parseModelWorkflowEnvelope } from "../replyParse";
import { taggedPromptData } from "../promptData";
import { firstRootCompileError } from "../../tools/parseCompileLog";
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

export const runCompileFixWorkflow: WorkflowHandler = async (input) => {
  const compiled = await input.services.runTool("compile", {}, input.ctx);
  if (!compiled.ok) {
    return invalidCompileFixResult(`编译失败：${compiled.error}`);
  }
  if (!isCompileToolPayload(compiled.data)) {
    return invalidCompileFixResult("编译工具返回了无效结构。");
  }

  const { compileOk, log } = compiled.data;
  if (compileOk) {
    return {
      agent: emptyAgentResult("compile-fix", "Project already compiles", []),
      content: "当前项目编译成功，不需要生成修复补丁。",
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
      compiled.data.error || "编译失败，但没有可用于安全定位的日志。",
      "",
      log,
    );
  }

  const diagnostic = firstRootCompileError(log);
  if (!diagnostic?.file || !diagnostic.line) {
    return invalidCompileFixResult(
      "无法从编译日志中安全定位错误文件和行号；未猜测或修改任何文件。",
      "",
      log,
    );
  }
  if (!(diagnostic.file in input.ctx.files)) {
    return invalidCompileFixResult(
      `编译日志指向项目外或未加载的文件：${diagnostic.file}；未修改其他文件。`,
      "",
      log,
    );
  }

  let snapshot: ContextSnapshot;
  try {
    const { lastCompileLog: _lastCompileLog, ...contextWithoutLog } = input.ctx;
    snapshot = await buildContextSnapshot({
      ...contextWithoutLog,
      activeFile: diagnostic.file,
    });
  } catch (error) {
    return invalidCompileFixResult(
      error instanceof Error ? error.message : String(error),
      "",
      log,
    );
  }
  const prepared = prepareCompileFix(snapshot, diagnostic);
  if (!prepared.ok) {
    return invalidCompileFixResult(prepared.message, "", log);
  }

  const raw = await input.services.complete({
    config: input.config,
    messages: [
      {
        role: "system",
        content: buildWorkflowSystemPrompt({
          workflow: "compile-fix",
          skillId: "fix-compile-errors",
          skill: fixCompileSkill,
        }),
      },
      { role: "user", content: prepared.prompt },
    ],
  });
  const parsed = parseModelWorkflowEnvelope(raw, "compile-fix");
  if (!parsed.ok) {
    return invalidCompileFixResult(parsed.error.message, parsed.rawContent, log);
  }
  if (parsed.envelope.citationPlanValue !== undefined || parsed.envelope.reviewValue !== undefined) {
    return invalidCompileFixResult(
      "Compile-fix returned a payload owned by another workflow",
      parsed.envelope.content,
      log,
    );
  }
  if (!parsed.envelope.proposal) {
    return invalidCompileFixResult(
      parsed.envelope.warnings.join(" ") || "模型没有提供可验证的修复补丁。",
      parsed.envelope.content,
      log,
    );
  }

  const converted = await compileFixProposalToPatch({
    rawProposal: parsed.envelope.proposal,
    snapshot,
    diagnostic,
  });
  if (!converted.ok) {
    return invalidCompileFixResult(converted.message, parsed.envelope.content, log);
  }
  return {
    agent: {
      schemaVersion: "1",
      workflow: "compile-fix",
      summary: parsed.envelope.summary,
      warnings: parsed.envelope.warnings,
      patch: converted.patchSet,
    },
    content: parsed.envelope.content || "已根据首个根错误生成最小修复补丁。Keep 后只重新编译一次。",
    toolNotes: ["compile:failed", "skill:fix-compile-errors"],
    lastCompileLog: log,
  };
};
