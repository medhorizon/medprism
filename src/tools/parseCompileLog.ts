import { isSafeProjectRelativePath } from "../lib/projectPath";
import type { CompileLogError, ToolDef } from "./types";

function normalizedPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const path = value.replace(/\\/g, "/").replace(/^\.\//, "");
  return isSafeProjectRelativePath(path) ? path : undefined;
}

function isWarning(message: string): boolean {
  return /warning|overfull|underfull|rerun to get cross-references right|undefined citations?|undefined references?|citation.*undefined|citations? may have changed/i.test(
    message,
  );
}

/**
 * Conservative parser: identifies the first root error and keeps warnings separate.
 * It never invents a file when the log cannot provide one.
 */
export function parseCompileLog(log: string): CompileLogError[] {
  const lines = log.split(/\r?\n/);
  const diagnostics: CompileLogError[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    const tectonicLocation = line.match(
      /^\s*-->\s+(.+?\.(?:tex|sty|cls|bib)):(\d+)(?::\d+)?\s*$/i,
    );
    if (tectonicLocation) {
      const file = normalizedPath(tectonicLocation[1]);
      const previousError = lines
        .slice(Math.max(0, index - 4), index)
        .reverse()
        .find((candidate) => /^\s*error:\s*/i.test(candidate));
      if (file && previousError) {
        diagnostics.push({
          severity: "error",
          file,
          line: Number(tectonicLocation[2]),
          message: previousError.replace(/^\s*error:\s*/i, "").trim() || "Tectonic error",
          raw: `${previousError}\n${line}`,
          isRootCause: false,
        });
      }
      continue;
    }

    const fileLine = line.match(/^(.+?\.(?:tex|sty|cls|bib)):(\d+):\s*(.+)$/i);
    if (fileLine) {
      const message = fileLine[3]!.trim();
      const file = normalizedPath(fileLine[1]);
      diagnostics.push({
        severity: isWarning(message) ? "warning" : "error",
        ...(file ? { file } : {}),
        line: Number(fileLine[2]),
        message,
        raw: line,
        isRootCause: false,
      });
      continue;
    }

    if (line.startsWith("!")) {
      const message = line.slice(1).trim() || "LaTeX error";
      let sourceLine: number | undefined;
      let raw = line;
      for (let cursor = index + 1; cursor < Math.min(lines.length, index + 6); cursor += 1) {
        const nearby = lines[cursor] ?? "";
        raw += `\n${nearby}`;
        const match = nearby.match(/^l\.(\d+)\s/);
        if (match) {
          sourceLine = Number(match[1]);
          break;
        }
      }
      const preceding = lines.slice(Math.max(0, index - 20), index).join("\n");
      const fileCandidates = [...preceding.matchAll(/\(([^()\s]+\.(?:tex|sty|cls|bib))\b/gi)];
      const file = normalizedPath(fileCandidates.at(-1)?.[1]);
      diagnostics.push({
        severity: "error",
        ...(file ? { file } : {}),
        ...(sourceLine === undefined ? {} : { line: sourceLine }),
        message,
        raw,
        isRootCause: false,
      });
      continue;
    }

    if (isWarning(line)) {
      diagnostics.push({
        severity: "warning",
        message: line.trim(),
        raw: line,
        isRootCause: false,
      });
    }
  }

  const firstError = diagnostics.find((diagnostic) => diagnostic.severity === "error");
  if (firstError) firstError.isRootCause = true;
  return diagnostics.slice(0, 50);
}

export function firstRootCompileError(log: string): CompileLogError | undefined {
  return parseCompileLog(log).find(
    (diagnostic) => diagnostic.severity === "error" && diagnostic.isRootCause,
  );
}

export const parseCompileLogTool: ToolDef = {
  name: "parse_compile_log",
  description: "Parse LaTeX output and identify the first root error without guessing a source file.",
  parameters: {
    type: "object",
    properties: { log: { type: "string" } },
    required: ["log"],
  },
  async execute(args, ctx) {
    const log = String(args.log ?? ctx.lastCompileLog ?? "");
    if (!log.trim()) return { ok: false, error: "compile log is empty", code: "EMPTY_LOG" };
    const diagnostics = parseCompileLog(log);
    return {
      ok: true,
      data: {
        diagnostics,
        rootError: diagnostics.find((item) => item.isRootCause),
      },
    };
  },
};
