import { filesForCompile } from "./projectBinary";

export type CompileRequest = {
  jobId?: string;
  files: Record<string, string>;
  mainFile: string;
  projectRevision?: string;
};

export type CompileResult = {
  ok: boolean;
  jobId?: string;
  clientJobId?: string;
  code?: string;
  log: string;
  pdfBase64?: string;
  error?: string;
  projectRevision?: string;
};

export async function compileProject(
  request: CompileRequest,
  signal?: AbortSignal,
): Promise<CompileResult> {
  const compileRequest: CompileRequest = {
    ...request,
    files: filesForCompile(request.files),
  };
  if (window.medprismDesktop?.compile) {
    if (signal?.aborted) {
      return { ok: false, code: "CANCELLED", log: "", error: "Compile cancelled" };
    }
    const onAbort = () => {
      const jobId = compileRequest.jobId;
      if (jobId) void window.medprismDesktop?.compile.cancel(jobId).catch(() => undefined);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await window.medprismDesktop.compile.run(compileRequest);
    } catch (error) {
      return {
        ok: false,
        code: signal?.aborted ? "CANCELLED" : "SERVICE_UNAVAILABLE",
        log: "",
        error: error instanceof Error ? error.message : "Electron compile service unavailable",
        ...(compileRequest.projectRevision
          ? { projectRevision: compileRequest.projectRevision }
          : {}),
      };
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  try {
    const response = await fetch("/api/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(compileRequest),
      ...(signal ? { signal } : {}),
    });
    const result = (await response.json()) as CompileResult;
    if (!response.ok && !result.error) {
      return { ...result, ok: false, error: `Compile service HTTP ${response.status}` };
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      code: signal?.aborted ? "CANCELLED" : "SERVICE_UNAVAILABLE",
      log: "",
      error: error instanceof Error ? error.message : "Compile service unavailable",
    };
  }
}

export async function cancelCompile(jobId: string): Promise<boolean> {
  if (!window.medprismDesktop?.compile) return false;
  try {
    return (await window.medprismDesktop.compile.cancel(jobId)).ok;
  } catch {
    return false;
  }
}

export async function isCompileAvailable(): Promise<boolean> {
  if (window.medprismDesktop?.compile) {
    try {
      return await window.medprismDesktop.compile.isAvailable();
    } catch {
      return false;
    }
  }
  try {
    const response = await fetch("/api/health");
    return response.ok;
  } catch {
    return false;
  }
}
