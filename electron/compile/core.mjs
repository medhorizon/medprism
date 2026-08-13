import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertSafeProjectRelativePath } from "../../shared/project-path.mjs";
import { prepareLatexForWordExport } from "./word-latex.mjs";

const WORD_REFERENCE_DOCX = path.join(path.dirname(fileURLToPath(import.meta.url)), "word-reference.docx");

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
    const bytes = fileBufferForCompile(content).length;
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
  if (request.synctex !== undefined && typeof request.synctex !== "boolean") {
    throw new CompileServiceError("INVALID_REQUEST", "synctex must be boolean");
  }
  return {
    files: normalizedFiles,
    mainFile,
    jobId: request.jobId || randomUUID(),
    projectRevision: request.projectRevision,
    synctex: request.synctex === true,
  };
}

const BINARY_FILE_PREFIX = "medprism-binary/v1;base64,";

function fileBufferForCompile(content) {
  if (typeof content === "string" && content.startsWith(BINARY_FILE_PREFIX)) {
    return Buffer.from(content.slice(BINARY_FILE_PREFIX.length), "base64");
  }
  return Buffer.from(content, "utf8");
}

async function writeTextProject(root, files) {
  const rootResolved = path.resolve(root);
  for (const [rel, content] of Object.entries(filesWithRootBibliographyStyles(files))) {
    const safe = assertSafeProjectRelativePath(rel);
    const full = path.resolve(rootResolved, ...safe.split("/"));
    if (full !== rootResolved && !full.startsWith(`${rootResolved}${path.sep}`)) {
      throw new CompileServiceError("UNSAFE_PATH", `Path escaped project root: ${safe}`);
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, fileBufferForCompile(content));
  }
}

export function filesWithRootBibliographyStyles(files) {
  const result = { ...files };
  const nestedByName = new Map();
  for (const [filePath, content] of Object.entries(files)) {
    if (!filePath.includes("/") || !filePath.toLowerCase().endsWith(".bst")) continue;
    const name = path.posix.basename(filePath);
    const candidates = nestedByName.get(name) ?? [];
    candidates.push(content);
    nestedByName.set(name, candidates);
  }
  for (const [name, candidates] of nestedByName) {
    if (!(name in result) && candidates.length === 1) result[name] = candidates[0];
  }
  return result;
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

export function bibliographyFailure(log) {
  if (/errors were issued by (?:BibTeX|Biber), but were ignored/i.test(log)) return true;
  const finalPassStart = Math.max(
    log.lastIndexOf("note: Rerunning TeX"),
    log.lastIndexOf("note: Running TeX"),
  );
  const finalPass = finalPassStart >= 0 ? log.slice(finalPassStart) : log;
  return /Package natbib Warning: There were undefined citations\./i.test(finalPass);
}

function pandocUtf8Environment() {
  const env = limitedEnvironment();
  if (!env.LANG && !env.LC_ALL) {
    env.LANG = "C.UTF-8";
    env.LC_ALL = "C.UTF-8";
  }
  return env;
}

function runProcess({
  cwd,
  args,
  signal,
  executable,
  spawnImpl,
  timeoutMs,
  startErrorLabel = "process",
  env = limitedEnvironment(),
}) {
  return new Promise((resolve) => {
    const child = spawnImpl(executable, args, {
      cwd,
      env,
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
      appendLog(log, `\n[medprism] Failed to start ${startErrorLabel}: ${error.message}\n`);
      finish({
        code: 1,
        spawnError: error.message,
        spawnCode: error && typeof error === "object" ? error.code : undefined,
      });
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

async function readCompiledSyncTex(root, mainFile) {
  const relativeSyncTex = mainFile.replace(/\.tex$/i, ".synctex.gz");
  const candidates = [
    path.resolve(root, ...relativeSyncTex.split("/")),
    path.resolve(root, path.basename(relativeSyncTex)),
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

function failedRequestResult(error, jobId) {
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
    return failedRequestResult(error, jobId);
  }

  let root;
  try {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "medprism-tex-"));
    await writeTextProject(root, request.files);
    const processResult = await runProcess({
      cwd: root,
      args: [
        "-X", "compile", "--untrusted", "--print", "--reruns", "2", "--outfmt", "pdf",
        ...(request.synctex ? ["--synctex"] : []),
        request.mainFile,
      ],
      signal,
      executable,
      spawnImpl,
      timeoutMs,
      startErrorLabel: "Tectonic",
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
    if (bibliographyFailure(processResult.log)) {
      return {
        ok: false,
        jobId,
        code: "UNRESOLVED_REFERENCES",
        log: processResult.log,
        error: "Bibliography processing failed; one or more citations are unresolved",
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
    const synctex = request.synctex
      ? await readCompiledSyncTex(root, request.mainFile)
      : null;
    if (request.synctex && !synctex) {
      return {
        ok: false,
        jobId,
        code: "SYNCTEX_MISSING",
        log: processResult.log,
        error: "Tectonic exited successfully but no SyncTeX data was found",
        projectRevision: request.projectRevision,
      };
    }
    return {
      ok: true,
      jobId,
      code: "OK",
      log: processResult.log,
      pdfBase64: pdf.toString("base64"),
      ...(synctex ? { synctexBase64: synctex.toString("base64") } : {}),
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

const WORD_EXPORT_TIMEOUT_MS = 60_000;

async function readExportedDocx(root, outputFile) {
  const candidates = [
    path.resolve(root, ...outputFile.split("/")),
    path.resolve(root, path.basename(outputFile)),
  ];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate);
    } catch {
      // Try next Pandoc output location.
    }
  }
  return null;
}

export async function exportWordProject(
  rawRequest,
  {
    signal,
    executable = process.env.MEDPRISM_PANDOC_PATH || "pandoc",
    spawnImpl = nodeSpawn,
    timeoutMs = WORD_EXPORT_TIMEOUT_MS,
  } = {},
) {
  let request;
  let jobId = randomUUID();
  try {
    request = validateCompileRequest(rawRequest);
    jobId = request.jobId;
  } catch (error) {
    return failedRequestResult(error, jobId);
  }

  const outputFile = request.mainFile.replace(/\.tex$/i, ".docx");
  let root;
  try {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "medprism-word-"));
    const files = { ...request.files };
    const mainSource = files[request.mainFile];
    if (typeof mainSource === "string") {
      files[request.mainFile] = prepareLatexForWordExport(mainSource);
    }
    await writeTextProject(root, files);
    const args = [request.mainFile, "-o", outputFile, "--from", "latex"];
    if (typeof files[request.mainFile] === "string" && /\\tableofcontents\b/.test(files[request.mainFile])) {
      args.push("--toc");
    }
    args.push("--reference-doc", WORD_REFERENCE_DOCX);
    const processResult = await runProcess({
      cwd: root,
      args,
      signal,
      executable,
      spawnImpl,
      timeoutMs,
      startErrorLabel: "Pandoc",
      env: pandocUtf8Environment(),
    });
    if (processResult.cancelled) {
      return {
        ok: false,
        jobId,
        code: "CANCELLED",
        log: processResult.log,
        error: "Word export cancelled",
      };
    }
    if (processResult.timedOut) {
      return {
        ok: false,
        jobId,
        code: "TIMEOUT",
        log: processResult.log,
        error: `Word export exceeded ${timeoutMs} ms`,
      };
    }
    if (processResult.spawnCode === "ENOENT") {
      return {
        ok: false,
        jobId,
        code: "ENGINE_UNAVAILABLE",
        log: processResult.log,
        error: "Pandoc not found",
      };
    }
    if (processResult.code !== 0) {
      return {
        ok: false,
        jobId,
        code: processResult.spawnError ? "ENGINE_UNAVAILABLE" : "EXPORT_FAILED",
        log: processResult.log,
        error: processResult.spawnError || "Pandoc export failed",
      };
    }
    const docx = await readExportedDocx(root, outputFile);
    if (!docx) {
      return {
        ok: false,
        jobId,
        code: "OUTPUT_MISSING",
        log: processResult.log,
        error: "Pandoc exited successfully but no Word document was found",
      };
    }
    return {
      ok: true,
      jobId,
      log: processResult.log,
      docxBase64: docx.toString("base64"),
    };
  } catch (error) {
    return {
      ok: false,
      jobId,
      code: error instanceof CompileServiceError ? error.code : "INTERNAL_ERROR",
      log: "",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (root) await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

const WORD_IMPORT_MAX_BYTES = 15 * 1024 * 1024;

function validateWordImportRequest(rawRequest) {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new CompileServiceError("INVALID_REQUEST", "Word import request must be an object");
  }
  if (rawRequest.jobId !== undefined &&
      (typeof rawRequest.jobId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(rawRequest.jobId))) {
    throw new CompileServiceError("INVALID_REQUEST", "jobId is invalid");
  }
  if (typeof rawRequest.docxBase64 !== "string" || rawRequest.docxBase64.length === 0) {
    throw new CompileServiceError("INVALID_REQUEST", "docxBase64 must be a non-empty string");
  }
  const bytes = Buffer.from(rawRequest.docxBase64, "base64");
  if (bytes.length === 0) {
    throw new CompileServiceError("INVALID_REQUEST", "docxBase64 is empty");
  }
  if (bytes.length > WORD_IMPORT_MAX_BYTES) {
    throw new CompileServiceError("LIMIT_EXCEEDED", "Word document exceeds 15MB");
  }
  return {
    bytes,
    jobId: rawRequest.jobId || randomUUID(),
  };
}

export async function importDocxProject(
  rawRequest,
  {
    signal,
    executable = process.env.MEDPRISM_PANDOC_PATH || "pandoc",
    spawnImpl = nodeSpawn,
    timeoutMs = WORD_EXPORT_TIMEOUT_MS,
  } = {},
) {
  let request;
  let jobId = randomUUID();
  try {
    request = validateWordImportRequest(rawRequest);
    jobId = request.jobId;
  } catch (error) {
    return failedRequestResult(error, jobId);
  }

  let root;
  try {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "medprism-docx-"));
    await fs.writeFile(path.join(root, "input.docx"), request.bytes);
    const processResult = await runProcess({
      cwd: root,
      args: ["input.docx", "-f", "docx", "-t", "markdown", "--wrap=none", "-o", "out.md"],
      signal,
      executable,
      spawnImpl,
      timeoutMs,
      startErrorLabel: "Pandoc",
      env: pandocUtf8Environment(),
    });
    if (processResult.cancelled) {
      return {
        ok: false,
        jobId,
        code: "CANCELLED",
        log: processResult.log,
        error: "Word import cancelled",
      };
    }
    if (processResult.timedOut) {
      return {
        ok: false,
        jobId,
        code: "TIMEOUT",
        log: processResult.log,
        error: `Word import exceeded ${timeoutMs} ms`,
      };
    }
    if (processResult.spawnCode === "ENOENT") {
      return {
        ok: false,
        jobId,
        code: "ENGINE_UNAVAILABLE",
        log: processResult.log,
        error: "Pandoc not found",
      };
    }
    if (processResult.code !== 0) {
      return {
        ok: false,
        jobId,
        code: processResult.spawnError ? "ENGINE_UNAVAILABLE" : "IMPORT_FAILED",
        log: processResult.log,
        error: processResult.spawnError || "Pandoc import failed",
      };
    }
    let markdown = "";
    try {
      markdown = (await fs.readFile(path.join(root, "out.md"), "utf8")).replace(/^\uFEFF/, "");
    } catch {
      markdown = "";
    }
    if (!markdown.trim()) {
      return {
        ok: false,
        jobId,
        code: "OUTPUT_MISSING",
        log: processResult.log,
        error: "Pandoc exited successfully but no markdown was found",
      };
    }
    return {
      ok: true,
      jobId,
      markdown,
      log: processResult.log,
    };
  } catch (error) {
    return {
      ok: false,
      jobId,
      code: error instanceof CompileServiceError ? error.code : "INTERNAL_ERROR",
      log: "",
      error: error instanceof Error ? error.message : String(error),
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
