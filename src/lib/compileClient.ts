export type CompileRequest = {
  files: Record<string, string>;
  mainFile: string;
};

export type CompileResponse = {
  ok: boolean;
  log: string;
  pdfBase64?: string;
  error?: string;
};

/** Call local Plan7A compile service via Vite proxy. */
export async function compileProject(
  req: CompileRequest,
  signal?: AbortSignal,
): Promise<CompileResponse> {
  let response: Response;
  try {
    response = await fetch("/api/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
  } catch (e) {
    return {
      ok: false,
      log: "",
      error:
        e instanceof Error
          ? e.message
          : "Cannot reach compile service. Run npm run compile:server and install Tectonic.",
    };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      log: text,
      error: `Compile service HTTP ${response.status}`,
    };
  }

  return (await response.json()) as CompileResponse;
}
