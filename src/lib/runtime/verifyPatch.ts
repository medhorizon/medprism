import type { CompileResult } from "../compileClient";
import type { ContextInput } from "../context/snapshot";
import { buildContextPackage } from "../context/snapshot";
import { projectRevision } from "../patch/revision";
import type { PatchSet } from "../patch/schema";
import { simulatePatchSet } from "../patch/simulate";
import { firstRootCompileError } from "../../tools/parseCompileLog";
import { prepareCompileFix, type CompileFixPreparation } from "../workflows/compileFix";

export type PatchVerificationResult =
  | {
      ok: true;
      files: Record<string, string>;
      compile: CompileResult | null;
    }
  | {
      ok: false;
      stage: "patch";
      error: string;
    }
  | {
      ok: false;
      stage: "compile";
      files: Record<string, string>;
      compile: CompileResult;
      repair: Extract<CompileFixPreparation, { ok: true }> | null;
    };

/**
 * Runtime-owned apply/compile boundary. It never commits files and never loops:
 * the caller decides whether to present the single repair preparation to an LLM.
 */
export async function verifyPatchApplication(args: {
  context: ContextInput;
  patchSet: PatchSet;
  compile: (request: {
    files: Record<string, string>;
    mainFile: string;
    projectRevision: string;
  }) => Promise<CompileResult>;
}): Promise<PatchVerificationResult> {
  const simulated = await simulatePatchSet(args.context.files, args.patchSet);
  if (!simulated.ok) {
    return { ok: false, stage: "patch", error: simulated.error.message };
  }
  const files = simulated.simulation.nextFiles;
  const affectsLatex = simulated.simulation.affectedPaths.some((path) => /\.(?:tex|bib)$/i.test(path));
  if (!affectsLatex) return { ok: true, files, compile: null };

  const basePackage = await buildContextPackage({ ...args.context, files });
  const mainFile = basePackage.mainFile;
  if (!mainFile) {
    return { ok: false, stage: "patch", error: "No main TeX file is available for verification" };
  }
  const revision = await projectRevision(files);
  const compiled = await args.compile({ files, mainFile, projectRevision: revision });
  if (compiled.ok) return { ok: true, files, compile: compiled };

  const log = compiled.log || compiled.error || "";
  const diagnostic = firstRootCompileError(log);
  if (!diagnostic) {
    return { ok: false, stage: "compile", files, compile: compiled, repair: null };
  }
  const failedPackage = await buildContextPackage({
    ...args.context,
    files,
    activeFile: diagnostic.file ?? basePackage.activeFile,
    lastCompileLog: log,
    selection: undefined,
  });
  const prepared = prepareCompileFix(failedPackage, diagnostic);
  return {
    ok: false,
    stage: "compile",
    files,
    compile: compiled,
    repair: prepared.ok ? prepared : null,
  };
}
