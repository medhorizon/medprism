import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { assertSafeProjectRelativePath } from "../../shared/project-path.mjs";

export const COMPILE_LIMITS = Object.freeze({
  maxFiles: 600,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 24 * 1024 * 1024,
  maxLogBytes: 2 * 1024 * 1024,
  // First Springer/ACM compiles often download many packages via Tectonic.
  timeoutMs: 120_000,
});

export class CompileServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CompileServiceError";
    this.code = code;
  }
}

function limitedEnvironment(source = process.env) {
  const allow = [
    "PATH",
    "Path",
    "HOME",
    "USERPROFILE",
    "TMP",
    "TEMP",
    "TMPDIR",
    "SYSTEMROOT",
    "WINDIR",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "TECTONIC_CACHE_DIR",
  ];
  return Object.fromEntries(
    allow.flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]]])),
  );
}

export function validateCompileRequest(request) {
  if (!request || typeof request !== "object") {
    throw new CompileServiceError("INVALID_REQUEST", "Compile request must be an object");
  }
  const files = request.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new CompileServiceError("INVALID_REQUEST", "files must be an object");
  }
  const entries = Object.entries(files);
  if (entries.length === 0 || entries.length > COMPILE_LIMITS.maxFiles) {
    throw new CompileServiceError(
      "LIMIT_EXCEEDED",
      `Project must contain 1-${COMPILE_LIMITS.maxFiles} files`,
    );
  }

  let totalBytes = 0;
  const normalizedFiles = {};
  for (const [rawPath, content] of entries) {
    const rel = assertSafeProjectRelativePath(rawPath);
    if (typeof content !== "string") {
      throw new CompileServiceError("BINARY_UNSUPPORTED", `Non-text file is unsupported: ${rel}`);
    }
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > COMPILE_LIMITS.maxFileBytes) {
      throw new CompileServiceError("LIMIT_EXCEEDED", `File too large: ${rel}`);
    }
    totalBytes += bytes;
    if (totalBytes > COMPILE_LIMITS.maxTotalBytes) {
      throw new CompileServiceError("LIMIT_EXCEEDED", "Project exceeds compile size limit");
    }
    if (Object.prototype.hasOwnProperty.call(normalizedFiles, rel)) {
      throw new CompileServiceError("INVALID_REQUEST", `Duplicate normalized path: ${rel}`);
    }
    normalizedFiles[rel] = content;
  }

  const mainFile = assertSafeProjectRelativePath(String(request.mainFile || "main.tex"));
  if (!(mainFile in normalizedFiles)) {
    throw new CompileServiceError("MAIN_FILE_MISSING", `mainFile missing: ${mainFile}`);
  }
  if (!mainFile.toLowerCase().endsWith(".tex")) {
    throw new CompileServiceError("INVALID_REQUEST", "mainFile must be a .tex file");
  }
  if (request.jobId !== undefined &&
      (typeof request.jobId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(request.jobId))) {
    throw new CompileServiceError("INVALID_REQUEST", "jobId is invalid");
  }
  if (request.projectRevision !== undefined &&
      (typeof request.projectRevision !== "string" || !/^[a-f0-9]{64}$/i.test(request.projectRevision))) {
    throw new CompileServiceError("INVALID_REQUEST", "projectRevision must be SHA-256");
  }
  return {
    files: normalizedFiles,
    mainFile,
    jobId: request.jobId || randomUUID(),
    projectRevision: request.projectRevision,
  };
}

async function writeTextProject(root, files) {
  const rootResolved = path.resolve(root);
  for (const [rel, content] of Object.entries(files)) {
    const safe = assertSafeProjectRelativePath(rel);
    const full = path.resolve(rootResolved, ...safe.split("/"));
    if (full !== rootResolved && !full.startsWith(`${rootResolved}${path.sep}`)) {
      throw new CompileServiceError("UNSAFE_PATH", `Path escaped project root: ${safe}`);
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }
}

function appendLog(state, chunk) {
  if (state.truncated) return;
  const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  const remaining = COMPILE_LIMITS.maxLogBytes - state.bytes;
  if (remaining <= 0) {
    state.text += "\n[medprism] compile log truncated\n";
    state.truncated = true;
    return;
  }
  const slice = value.subarray(0, remaining);
  state.text += slice.toString("utf8");
  state.bytes += slice.length;
  if (slice.length < value.length) {
    state.text += "\n[medprism] compile log truncated\n";
    state.truncated = true;
  }
}

function runProcess({ cwd, mainFile, signal, executable, spawnImpl, timeoutMs }) {
  return new Promise((resolve) => {
    const args = ["-X", "compile", "--untrusted", "--outfmt", "pdf", mainFile];
    const child = spawnImpl(executable, args, {
      cwd,
      env: limitedEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const log = { text: "", bytes: 0, truncated: false };
    let settled = false;
    let closed = false;
    let timedOut = false;
    let cancelled = false;
    let timer;
    let killTimer;
    let settleTimer;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (settleTimer) clearTimeout(settleTimer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ ...value, log: log.text, timedOut, cancelled });
    };
    const terminate = () => {
      if (closed || settled) return;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (closed || settled) return;
        child.kill("SIGKILL");
        // A broken child process may never emit close. Bound the queue slot and
        // temporary-directory lifetime even in that failure mode.
        settleTimer = setTimeout(() => {
          if (!closed && !settled) finish({ code: 1, processSignal: "SIGKILL" });
        }, 250);
        settleTimer.unref?.();
      }, 1000);
      killTimer.unref?.();
    };
    const onAbort = () => {
      cancelled = true;
      terminate();
    };
    if (signal?.aborted) {
      cancelled = true;
      terminate();
    } else {
      signal?.addEventListener("abort", onAbort, { once: true });
    }

    timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on("data", (chunk) => appendLog(log, chunk));
    child.stderr?.on("data", (chunk) => appendLog(log, chunk));
    child.on("error", (error) => {
      appendLog(log, `\n[medprism] Failed to start Tectonic: ${error.message}\n`);
      finish({ code: 1, spawnError: error.message });
    });
    child.on("close", (code, processSignal) => {
      closed = true;
      finish({ code: code ?? 1, processSignal });
    });
  });
}

async function readCompiledPdf(root, mainFile) {
  const relativePdf = mainFile.replace(/\.tex$/i, ".pdf");
  const candidates = [
    path.resolve(root, ...relativePdf.split("/")),
    path.resolve(root, path.basename(relativePdf)),
  ];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch {
      // Try next Tectonic output location.
    }
  }
  return null;
}

export async function compileProject(
  rawRequest,
  {
    signal,
    executable = "tectonic",
    spawnImpl = nodeSpawn,
    timeoutMs = COMPILE_LIMITS.timeoutMs,
  } = {},
) {
  let request;
  let jobId = randomUUID();
  try {
    request = validateCompileRequest(rawRequest);
    jobId = request.jobId;
  } catch (error) {
    return {
      ok: false,
      jobId,
      code:
        error instanceof CompileServiceError
          ? error.code
          : error && typeof error === "object" && error.name === "UnsafeProjectPathError"
            ? "UNSAFE_PATH"
            : "INVALID_REQUEST",
      log: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let root;
  try {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "medprism-tex-"));
    await writeTextProject(root, request.files);
    const processResult = await runProcess({
      cwd: root,
      mainFile: request.mainFile,
      signal,
      executable,
      spawnImpl,
      timeoutMs,
    });
    if (processResult.cancelled) {
      return {
        ok: false,
        jobId,
        code: "CANCELLED",
        log: processResult.log,
        error: "Compile cancelled",
        projectRevision: request.projectRevision,
      };
    }
    if (processResult.timedOut) {
      return {
        ok: false,
        jobId,
        code: "TIMEOUT",
        log: processResult.log,
        error: `Compile exceeded ${timeoutMs} ms`,
        projectRevision: request.projectRevision,
      };
    }
    if (processResult.code !== 0) {
      return {
        ok: false,
        jobId,
        code: processResult.spawnError ? "ENGINE_UNAVAILABLE" : "COMPILE_FAILED",
        log: processResult.log,
        error: processResult.spawnError || "Tectonic compile failed",
        projectRevision: request.projectRevision,
      };
    }
    const pdf = await readCompiledPdf(root, request.mainFile);
    if (!pdf) {
      return {
        ok: false,
        jobId,
        code: "PDF_MISSING",
        log: processResult.log,
        error: "Tectonic exited successfully but no PDF was found",
        projectRevision: request.projectRevision,
      };
    }
    return {
      ok: true,
      jobId,
      code: "OK",
      log: processResult.log,
      pdfBase64: pdf.toString("base64"),
      projectRevision: request.projectRevision,
    };
  } catch (error) {
    return {
      ok: false,
      jobId,
      code: error instanceof CompileServiceError ? error.code : "INTERNAL_ERROR",
      log: "",
      error: error instanceof Error ? error.message : String(error),
      projectRevision: request.projectRevision,
    };
  } finally {
    if (root) await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function isCompileEngineAvailable({ executable = "tectonic", spawnImpl = nodeSpawn } = {}) {
  return new Promise((resolve) => {
    const child = spawnImpl(executable, ["--version"], {
      shell: false,
      windowsHide: true,
      env: limitedEnvironment(),
      stdio: "ignore",
    });
    let settled = false;
    const finish = (available) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(available);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(false);
    }, 3000);
    timer.unref?.();
    child.on("error", () => finish(false));
    child.on("close", (code) => finish(code === 0));
  });
}
