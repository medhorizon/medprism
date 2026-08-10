import { env } from "./env.mjs";
import { sendJson } from "./http.mjs";

function joinChatUrl(baseUrl) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  return `${base}/chat/completions`;
}

/**
 * Forward OpenAI-compatible chat completions.
 * Prefer explicit UPSTREAM_*; otherwise use the signed-in user's NewAPI key
 * against NEWAPI_PUBLIC_BASE_URL (so production need not set a global upstream key).
 */
export async function proxyChatCompletions(req, res, body, userApiKey = "") {
  let baseUrl = env.upstreamBaseUrl;
  let apiKey = env.upstreamApiKey;
  if ((!baseUrl || !apiKey) && userApiKey && env.newApiPublicBaseUrl) {
    baseUrl = env.newApiPublicBaseUrl;
    apiKey = userApiKey;
  }

  if (!baseUrl || !apiKey) {
    sendJson(res, 503, {
      error: {
        message:
          "Upstream model is not configured. Set UPSTREAM_BASE_URL and UPSTREAM_API_KEY on the auth server, or configure NewAPI so each user key can be proxied.",
        type: "upstream_not_configured",
        code: "upstream_not_configured",
      },
    });
    return;
  }

  const url = joinChatUrl(baseUrl);
  let upstream;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
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
