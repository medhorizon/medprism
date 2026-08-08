import { env } from "./env.mjs";
import { sendJson } from "./http.mjs";

function joinChatUrl(baseUrl) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  return `${base}/chat/completions`;
}

/** Forward OpenAI-compatible chat completions, or return a clear error if upstream is empty. */
export async function proxyChatCompletions(req, res, body) {
  if (!env.upstreamBaseUrl || !env.upstreamApiKey) {
    sendJson(res, 503, {
      error: {
        message:
          "Upstream model is not configured. Set UPSTREAM_BASE_URL and UPSTREAM_API_KEY on the auth server.",
        type: "upstream_not_configured",
        code: "upstream_not_configured",
      },
    });
    return;
  }

  const url = joinChatUrl(env.upstreamBaseUrl);
  let upstream;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.upstreamApiKey}`,
      },
      body: JSON.stringify({
        ...body,
        stream: false,
      }),
    });
  } catch (e) {
    sendJson(res, 502, {
      error: {
        message: e instanceof Error ? e.message : "Upstream network error",
        type: "upstream_network",
        code: "upstream_network",
      },
    });
    return;
  }

  const text = await upstream.text();
  res.statusCode = upstream.status;
  res.setHeader(
    "Content-Type",
    upstream.headers.get("content-type") || "application/json; charset=utf-8",
  );
  res.end(text);
}
