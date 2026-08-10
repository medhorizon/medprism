import http from "node:http";
import { URL } from "node:url";
import { consumeCode, isValidEmail, issueCode, normalizeEmail } from "./lib/codes.mjs";
import { env } from "./lib/env.mjs";
import { bearerToken, readJson, sendJson, setCors } from "./lib/http.mjs";
import { publicHostedCredentials } from "./lib/newapi.mjs";
import { proxyChatCompletions } from "./lib/proxy.mjs";
import {
  issueAccessToken,
  issueRefreshToken,
  resolveAccessToken,
  resolveRefreshToken,
  revokeAccessToken,
  revokeRefreshToken,
} from "./lib/tokens.mjs";
import {
  ensureUserNewApiKey,
  findUserByEmail,
  upsertUserByEmail,
} from "./lib/users.mjs";

// Ensure DB initializes on boot.
import "./lib/db.mjs";

async function sessionPayload(user) {
  const ensured = await ensureUserNewApiKey(user);
  const { token: accessToken } = issueAccessToken(user.id);
  const { token: refreshToken } = issueRefreshToken(user.id);
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
    },
    accessToken,
    refreshToken,
    hosted: publicHostedCredentials({
      apiKey: ensured.apiKey,
      accessToken,
    }),
  };
}

const server = http.createServer(async (req, res) => {
  setCors(res, req);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, {
        ok: true,
        mailMode: env.mailMode,
        newApi: Boolean(env.newApiBaseUrl && env.newApiAccessToken),
      });
      return;
    }

    if (req.method === "POST" && path === "/auth/code") {
      const body = await readJson(req);
      const email = normalizeEmail(body.contact);
      if (!isValidEmail(email)) {
        sendJson(res, 400, { error: "invalid_contact" });
        return;
      }
      const result = await issueCode(email);
      if (!result.ok) {
        sendJson(res, 429, { error: result.error });
        return;
      }
      sendJson(res, 202, { ok: true });
      return;
    }

    if (req.method === "POST" && path === "/auth/verify") {
      const body = await readJson(req);
      const email = normalizeEmail(body.contact);
      const code = String(body.code || "").trim();
      if (!isValidEmail(email)) {
        sendJson(res, 400, { error: "invalid_contact" });
        return;
      }
      const checked = consumeCode(email, code);
      if (!checked.ok) {
        sendJson(res, 401, { error: checked.error });
        return;
      }
      const user = upsertUserByEmail(email);
      const payload = await sessionPayload(user);
      sendJson(res, 200, payload);
      return;
    }

    /** Login without OTP: email must already be registered. */
    if (req.method === "POST" && path === "/auth/login") {
      const body = await readJson(req);
      const email = normalizeEmail(body.contact);
      if (!isValidEmail(email)) {
        sendJson(res, 400, { error: "invalid_contact" });
        return;
      }
      const user = findUserByEmail(email);
      if (!user) {
        sendJson(res, 404, { error: "not_registered" });
        return;
      }
      const payload = await sessionPayload(user);
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "POST" && path === "/auth/refresh") {
      const body = await readJson(req);
      const refresh = String(body.refreshToken || "").trim();
      const session = resolveRefreshToken(refresh);
      if (!session) {
        sendJson(res, 401, { error: "invalid_refresh" });
        return;
      }
      // Rotate refresh token.
      revokeRefreshToken(refresh);
      const payload = await sessionPayload(session.user);
      sendJson(res, 200, payload);
      return;
    }

    if (req.method === "GET" && path === "/auth/me") {
      const token = bearerToken(req);
      const session = resolveAccessToken(token);
      if (!session) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        user: {
          id: session.user.id,
          email: session.user.email,
          displayName: session.user.display_name,
        },
        hosted: {
          baseUrl: env.newApiPublicBaseUrl,
          model: env.hostedDefaultModel,
          hasApiKey: Boolean(session.user.newapi_api_key),
        },
      });
      return;
    }

    if (req.method === "POST" && path === "/auth/logout") {
      const token = bearerToken(req);
      revokeAccessToken(token);
      const body = await readJson(req).catch(() => ({}));
      if (body?.refreshToken) {
        revokeRefreshToken(String(body.refreshToken));
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && path === "/v1/chat/completions") {
      const token = bearerToken(req);
      const session = resolveAccessToken(token);
      if (!session) {
        sendJson(res, 401, {
          error: {
            message: "Invalid or expired access token",
            type: "unauthorized",
            code: "unauthorized",
          },
        });
        return;
      }
      const body = await readJson(req);
      let userApiKey = session.user.newapi_api_key || "";
      if (!userApiKey) {
        try {
          const ensured = await ensureUserNewApiKey(session.user);
          userApiKey = ensured.apiKey || "";
        } catch (error) {
          sendJson(res, 503, {
            error: {
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to resolve NewAPI credentials",
              type: "upstream_not_configured",
              code: "upstream_not_configured",
            },
          });
          return;
        }
      }
      await proxyChatCompletions(req, res, body, userApiKey);
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (e) {
    console.error(e);
    sendJson(res, 500, {
      error: e instanceof Error ? e.message : "internal_error",
    });
  }
});

server.listen(env.port, () => {
  console.log(`[medprism-auth] listening on http://localhost:${env.port}`);
  console.log(`[medprism-auth] MAIL_MODE=${env.mailMode}`);
  console.log(
    `[medprism-auth] NewAPI=${env.newApiBaseUrl || "(not set)"} user=${
      env.newApiUserId || "?"
    }`,
  );
  console.log(`[medprism-auth] publicBase=${env.newApiPublicBaseUrl}`);
});
