import { compileProject } from "../lib/compileClient";
import { projectRevision } from "../lib/patch/revision";
import { assertSafeProjectRelativePath } from "../lib/projectPath";
import type { ToolDef } from "./types";

export const compileTool: ToolDef = {
  name: "compile",
  description:
    "Compile an immutable snapshot of the current LaTeX project. Returns revision-bound PDF/log output.",
  parameters: {
    type: "object",
    properties: { mainFile: { type: "string" } },
  },
  async execute(args, ctx) {
    const candidate =
      String(args.mainFile ?? ctx.mainFile ?? "").trim() ||
      Object.keys(ctx.files).find((path) => /(^|\/)main\.tex$/i.test(path)) ||
      Object.keys(ctx.files).find((path) => path.toLowerCase().endsWith(".tex"));
    if (!candidate) return { ok: false, error: "No main .tex file found", code: "MAIN_FILE_MISSING" };

    let mainFile: string;
    try {
      mainFile = assertSafeProjectRelativePath(candidate);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: "UNSAFE_PATH",
      };
    }
    if (!(mainFile in ctx.files)) {
      return { ok: false, error: `No main file found: ${mainFile}`, code: "MAIN_FILE_MISSING" };
    }

    const revision = await projectRevision(ctx.files);
    const result = await compileProject({
      jobId: crypto.randomUUID(),
      files: { ...ctx.files },
      mainFile,
      projectRevision: revision,
    });
    if (result.error && !result.log) {
      return {
        ok: false,
        error: result.error,
        ...(result.code ? { code: result.code } : {}),
      };
    }
    return {
      ok: true,
      data: {
        compileOk: result.ok,
        log: result.log,
        ...(result.pdfBase64 ? { pdfBase64: result.pdfBase64 } : {}),
        mainFile,
        ...(result.error ? { error: result.error } : {}),
        ...(result.code ? { code: result.code } : {}),
        projectRevision: result.projectRevision ?? revision,
      },
    };
  },
};
