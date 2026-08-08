/**
 * Plan7A / Plan8B — local Tectonic compile service.
 * POST /api/compile { files, mainFile } → { ok, log, pdfBase64? }
 */
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT || 8788);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const safe = rel.replace(/\\/g, "/").replace(/^\/+/, "");
    if (safe.includes("..")) continue;
    const full = path.join(root, safe);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }
}

function runTectonic(cwd, mainFile) {
  return new Promise((resolve) => {
    const args = ["-X", "compile", mainFile, "--outfmt", "pdf"];
    const child = spawn("tectonic", args, {
      cwd,
      env: process.env,
      shell: process.platform === "win32",
    });
    let log = "";
    child.stdout.on("data", (d) => {
      log += d.toString();
    });
    child.stderr.on("data", (d) => {
      log += d.toString();
    });
    child.on("error", (err) => {
      resolve({
        code: 1,
        log:
          log +
          `\n[medprism] Failed to spawn tectonic: ${err.message}\n` +
          "Install Tectonic and ensure it is on PATH. See docs/compile-setup.md\n",
      });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, log });
    });
  });
}

async function handleCompile(body) {
  const files = body?.files;
  const mainFile = String(body?.mainFile || "main.tex").replace(/\\/g, "/");
  if (!files || typeof files !== "object") {
    return { status: 400, body: { ok: false, log: "", error: "files object required" } };
  }
  if (!(mainFile in files)) {
    return { status: 400, body: { ok: false, log: "", error: `mainFile missing: ${mainFile}` } };
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "medprism-tex-"));
  try {
    await writeTree(root, files);
    const { code, log } = await runTectonic(root, mainFile);
    const pdfName = mainFile.replace(/\.tex$/i, ".pdf");
    const pdfPath = path.join(root, path.basename(pdfName));
    let pdfBase64;
    if (code === 0) {
      try {
        const buf = await fs.readFile(pdfPath);
        pdfBase64 = buf.toString("base64");
      } catch {
        // tectonic may write next to main in nested dirs
        const alt = path.join(root, pdfName);
        try {
          const buf = await fs.readFile(alt);
          pdfBase64 = buf.toString("base64");
        } catch {
          /* no pdf */
        }
      }
    }
    return {
      status: 200,
      body: {
        ok: code === 0 && !!pdfBase64,
        log,
        pdfBase64,
        error: code === 0 ? undefined : "Tectonic compile failed",
      },
    };
  } finally {
    fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/health")) {
    sendJson(res, 200, { ok: true, service: "medprism-compile" });
    return;
  }

  if (req.method === "POST" && (url.pathname === "/api/compile" || url.pathname === "/compile")) {
    try {
      const raw = await readBody(req);
      const json = raw ? JSON.parse(raw) : {};
      const result = await handleCompile(json);
      sendJson(res, result.status, result.body);
    } catch (e) {
      sendJson(res, 500, {
        ok: false,
        log: "",
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: "not found" });
});

server.listen(PORT, () => {
  console.log(`[medprism-compile] listening on http://127.0.0.1:${PORT}`);
});
