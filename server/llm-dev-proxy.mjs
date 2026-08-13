import dns from "node:dns";
import { Readable } from "node:stream";

export const LLM_DEV_PROXY_PATH = "/__medprism/llm/chat/completions";
export const LLM_DEV_PROXY_BASE_HEADER = "x-medprism-llm-base";

// Node fetch (undici) does not Happy-Eyeballs like the browser. On Windows this
// often becomes TypeError: fetch failed when an API has a broken AAAA record.
dns.setDefaultResultOrder("ipv4first");

export function resolveUpstreamChatUrl(baseUrl) {
  const raw = String(baseUrl || "").trim();
  if (!raw) throw new Error("LLM base URL is missing");
  const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LLM base URL must be http or https");
  }
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/chat/completions") ? path : `${path}/chat/completions`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export function describeFetchError(error, upstreamUrl) {
  const messages = [];
  let current = error;
  const seen = new Set();
  while (current && !seen.has(current) && messages.length < 4) {
    seen.add(current);
    if (current instanceof Error && current.message) {
      if (!messages.includes(current.message)) messages.push(current.message);
    } else if (typeof current === "string" && current && !messages.includes(current)) {
      messages.push(current);
    }
    current = current && typeof current === "object" ? current.cause : undefined;
  }
  const detail = messages.join(": ") || "Upstream network error";
  try {
    return `${detail} (${new URL(upstreamUrl).origin})`;
  } catch {
    return detail;
  }
}

export async function llmDevProxyMiddleware(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("method not allowed");
    return;
  }

  let upstreamUrl;
  try {
    const header = req.headers[LLM_DEV_PROXY_BASE_HEADER];
    const base = Array.isArray(header) ? header[0] : header;
    upstreamUrl = resolveUpstreamChatUrl(base);
  } catch (error) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    return;
  }

  const authorization = req.headers.authorization;
  if (!authorization) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Authorization is required" }));
    return;
  }

  try {
    const body = await readBody(req);
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": req.headers["content-type"] || "application/json",
        Authorization: authorization,
      },
      body,
    });
    res.statusCode = upstream.status;
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    if (upstream.body) {
      const nodeStream = Readable.fromWeb(upstream.body);
      nodeStream.on("error", () => {
        if (!res.writableEnded) res.end();
      });
      nodeStream.pipe(res);
      return;
    }
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    if (res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: describeFetchError(error, upstreamUrl) }));
  }
}
