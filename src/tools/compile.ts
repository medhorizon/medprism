import { compileProject } from "../lib/compileClient";
import type { ToolDef } from "./types";

export const compileTool: ToolDef = {
  name: "compile",
  description:
    "Compile the current LaTeX project with the local Tectonic service. Returns compileOk, log, and optional pdfBase64.",
  parameters: {
    type: "object",
    properties: {
      mainFile: { type: "string", description: "Main .tex path (optional)" },
    },
  },
  async execute(args, ctx) {
    const mainFile =
      String(args.mainFile ?? ctx.mainFile ?? "").trim() ||
      Object.keys(ctx.files).find((k) => /(^|\/)main\.tex$/i.test(k)) ||
      Object.keys(ctx.files).find((k) => k.endsWith(".tex"));

    if (!mainFile || !(mainFile in ctx.files)) {
      return { ok: false, error: "No main .tex file found in project." };
    }

    const result = await compileProject({
      files: ctx.files,
      mainFile,
    });

    if (result.error && !result.log) {
      return { ok: false, error: result.error };
    }

    return {
      ok: true,
      data: {
        compileOk: result.ok,
        log: result.log,
        pdfBase64: result.pdfBase64,
        mainFile,
        error: result.error,
      },
    };
  },
};
