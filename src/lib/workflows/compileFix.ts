import type { ContextSnapshot } from "../context/snapshot";
import { parseModelPatchProposal, type ModelPatchProposal, type PatchSet, type SourceRange } from "../patch/schema";
import { hydratePatchProposal } from "../patch/hydrate";
import type { CompileLogError } from "../../tools/types";

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
      "Repair exactly one root LaTeX compilation error.",
      "Return a JSON patchProposal with exactly one minimal replace_text operation.",
      "The oldText must be copied from the supplied source window.",
      "Do not output hashes; the runtime attaches deterministic metadata.",
      "Do not rewrite scientific prose unless required by the error.",
      `Root diagnostic:\n${JSON.stringify(diagnostic, null, 2)}`,
      `Target file: ${diagnostic.file}`,
      `Source around the error:\n${window.text}`,
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
    verify: { compile: true },
    operations: [{ ...operation, path }],
  };
  const hydrated = await hydratePatchProposal(proposal, scopedSnapshot, {
    allowedPaths: [path],
    strictSelection: true,
    forceCompileVerification: true,
  });
  if (!hydrated.ok) {
    return { ok: false, code: hydrated.error.code, message: hydrated.error.message };
  }
  return { ok: true, patchSet: hydrated.patchSet };
}
