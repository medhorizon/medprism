import { env } from "./env.mjs";

export function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", env.corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

export async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

export function bearerToken(req) {
  const header = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1].trim() : "";
}
