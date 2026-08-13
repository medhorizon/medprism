import { filesForCompile } from "./projectBinary";

export type CompileRequest = {
  jobId?: string;
  files: Record<string, string>;
  mainFile: string;
  projectRevision?: string;
  synctex?: boolean;
};

export type CompileResult = {
  ok: boolean;
  jobId?: string;
  clientJobId?: string;
  code?: string;
  log: string;
  pdfBase64?: string;
  synctexBase64?: string;
  error?: string;
  projectRevision?: string;
};

export type WordExportResult = {
  ok: boolean;
  jobId?: string;
  code?: string;
  log?: string;
  docxBase64?: string;
  error?: string;
};

export type WordImportResult = {
  ok: boolean;
  jobId?: string;
  code?: string;
  log?: string;
  markdown?: string;
  error?: string;
};

export async function compileProject(
  request: CompileRequest,
  signal?: AbortSignal,
): Promise<CompileResult> {
  const compileRequest: CompileRequest = {
    ...request,
    files: filesForCompile(request.files, request.mainFile),
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

export async function exportProjectWord(request: CompileRequest): Promise<WordExportResult> {
  const exportRequest: CompileRequest = {
    ...request,
    files: filesForCompile(request.files, request.mainFile),
  };
  if (window.medprismDesktop?.compile?.exportWord) {
    try {
      return await window.medprismDesktop.compile.exportWord(exportRequest);
    } catch (error) {
      return {
        ok: false,
        code: "SERVICE_UNAVAILABLE",
        log: "",
        error: error instanceof Error ? error.message : "Electron Word export unavailable",
      };
    }
  }

  try {
    const response = await fetch("/api/export-word", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exportRequest),
    });
    const result = (await response.json()) as WordExportResult;
    if (!response.ok && !result.error) {
      return { ...result, ok: false, error: `Word export HTTP ${response.status}` };
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      log: "",
      error: error instanceof Error ? error.message : "Word export service unavailable",
    };
  }
}

export async function importWordMarkdown(request: { docxBase64: string }): Promise<WordImportResult> {
  if (window.medprismDesktop?.compile?.importWord) {
    try {
      return await window.medprismDesktop.compile.importWord(request);
    } catch (error) {
      return {
        ok: false,
        code: "SERVICE_UNAVAILABLE",
        log: "",
        error: error instanceof Error ? error.message : "Electron Word import unavailable",
      };
    }
  }

  try {
    const response = await fetch("/api/import-word", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const result = (await response.json()) as WordImportResult;
    if (!response.ok && !result.error) {
      return { ...result, ok: false, error: `Word import HTTP ${response.status}` };
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      log: "",
      error: error instanceof Error ? error.message : "Word import service unavailable",
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
