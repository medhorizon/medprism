import type { CompileLogError, ToolDef } from "./types";

/** Parse common TeX / Tectonic log lines into structured errors. */
export function parseCompileLog(log: string): CompileLogError[] {
  if (!log.trim()) return [];

  const errors: CompileLogError[] = [];
  const lines = log.split(/\r?\n/);

  // ! error message
  // l.42 ...
  // or file.tex:12: ...
  const fileLineRe = /^(.+?):(\d+):\s*(.+)$/;
  const bangRe = /^!\s+(.+)$/;
  const lLineRe = /^l\.(\d+)\s*(.*)$/;

  let pendingBang: string | null = null;

  for (const line of lines) {
    const fileMatch = line.match(fileLineRe);
    if (fileMatch) {
      errors.push({
        file: fileMatch[1],
        line: Number(fileMatch[2]),
        message: fileMatch[3].trim(),
        raw: line,
      });
      pendingBang = null;
      continue;
    }

    const bang = line.match(bangRe);
    if (bang) {
      pendingBang = bang[1].trim();
      continue;
    }

    const lLine = line.match(lLineRe);
    if (lLine && pendingBang) {
      errors.push({
        line: Number(lLine[1]),
        message: pendingBang,
        raw: `${pendingBang} @ l.${lLine[1]} ${lLine[2] ?? ""}`.trim(),
      });
      pendingBang = null;
      continue;
    }
  }

  if (pendingBang) {
    errors.push({ message: pendingBang, raw: pendingBang });
  }

  // Fallback: keep first "! " lines if nothing structured
  if (errors.length === 0) {
    for (const line of lines) {
      if (line.startsWith("!")) {
        errors.push({ message: line.slice(1).trim(), raw: line });
      }
    }
  }

  return errors.slice(0, 20);
}

export const parseCompileLogTool: ToolDef = {
  name: "parse_compile_log",
  description: "Parse the latest LaTeX/Tectonic compile log into structured errors.",
  parameters: {
    type: "object",
    properties: {
      log: { type: "string", description: "Raw compile log (optional; uses context lastCompileLog)" },
    },
  },
  async execute(args, ctx) {
    const log = String(args.log ?? ctx.lastCompileLog ?? "");
    if (!log.trim()) {
      return { ok: false, error: "No compile log available. Compile the project first." };
    }
    const errors = parseCompileLog(log);
    return {
      ok: true,
      data: { count: errors.length, errors, logPreview: log.slice(0, 4000) },
    };
  },
};
