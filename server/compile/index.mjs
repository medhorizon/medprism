/** Development-only HTTP adapter. Packaged Electron uses typed IPC. */
import http from "node:http";
import { compileProject, exportWordProject, importDocxProject } from "../../electron/compile/core.mjs";

const PORT = Number(process.env.PORT || 8788);
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const ALLOWED_ORIGINS = new Set(
  (process.env.MEDPRISM_DEV_ORIGIN || "http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5174")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function sendJson(res, status, body, origin) {
  const payload = JSON.stringify(body);
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  res.writeHead(status, headers);
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    sendJson(res, 403, { ok: false, error: "Origin not allowed" }, origin);
    return;
  }
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {}, origin);
    return;
  }
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/health")) {
    sendJson(res, 200, { ok: true, service: "medprism-compile-dev" }, origin);
    return;
  }
  if (req.method === "POST" && (url.pathname === "/api/compile" || url.pathname === "/compile")) {
    try {
      const result = await compileProject(await readJson(req));
      sendJson(res, result.ok ? 200 : 400, result, origin);
    } catch (error) {
      sendJson(
        res,
        /too large/i.test(String(error)) ? 413 : 400,
        { ok: false, log: "", error: error instanceof Error ? error.message : String(error) },
        origin,
      );
    }
    return;
  }
  if (req.method === "POST" && (url.pathname === "/api/export-word" || url.pathname === "/export-word")) {
    try {
      const result = await exportWordProject(await readJson(req));
      sendJson(res, result.ok ? 200 : 400, result, origin);
    } catch (error) {
      sendJson(
        res,
        /too large/i.test(String(error)) ? 413 : 400,
        { ok: false, log: "", error: error instanceof Error ? error.message : String(error) },
        origin,
      );
    }
    return;
  }
  if (req.method === "POST" && (url.pathname === "/api/import-word" || url.pathname === "/import-word")) {
    try {
      const result = await importDocxProject(await readJson(req));
      sendJson(res, result.ok ? 200 : 400, result, origin);
    } catch (error) {
      sendJson(
        res,
        /too large/i.test(String(error)) ? 413 : 400,
        { ok: false, log: "", error: error instanceof Error ? error.message : String(error) },
        origin,
      );
    }
    return;
  }
  sendJson(res, 404, { ok: false, error: "not found" }, origin);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[medprism-compile-dev] listening on http://127.0.0.1:${PORT}`);
});
