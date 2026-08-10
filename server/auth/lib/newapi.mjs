import { env } from "./env.mjs";

function newApiHeaders() {
  return {
    Authorization: `Bearer ${env.newApiAccessToken}`,
    "New-Api-User": String(env.newApiUserId),
    "Content-Type": "application/json",
  };
}

function tokenNameFromEmail(email) {
  const raw = String(email || "").trim().toLowerCase();
  if (raw.length <= 50) return raw;
  return `${raw.slice(0, 40)}…${raw.slice(-6)}`;
}

async function newApiJson(path, init = {}) {
  const url = `${env.newApiBaseUrl.replace(/\/+$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...newApiHeaders(),
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`NewAPI non-JSON ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok || data.success === false) {
    throw new Error(
      data.message || `NewAPI ${res.status} ${path}: ${text.slice(0, 200)}`,
    );
  }
  return data;
}

async function findTokenByName(name) {
  const data = await newApiJson("/api/token/?p=0&page_size=100");
  const items = data?.data?.items || [];
  const matches = items.filter((item) => item.name === name);
  if (matches.length === 0) return null;
  // Prefer the newest id if duplicates exist.
  matches.sort((a, b) => (b.id || 0) - (a.id || 0));
  return matches[0];
}

async function createToken(name, quota = env.newApiTokenQuota) {
  const remainQuota = Math.max(1, Number(quota) || 200);
  await newApiJson("/api/token/", {
    method: "POST",
    body: JSON.stringify({
      name,
      remain_quota: remainQuota,
      expired_time: -1,
      unlimited_quota: false,
    }),
  });
  const created = await findTokenByName(name);
  if (!created?.id) {
    throw new Error("NewAPI token created but not found in list");
  }
  return created;
}

async function revealTokenKey(tokenId) {
  const data = await newApiJson("/api/token/batch/keys", {
    method: "POST",
    body: JSON.stringify({ ids: [tokenId] }),
  });
  const key = data?.data?.keys?.[String(tokenId)] ?? data?.data?.keys?.[tokenId];
  if (!key) {
    throw new Error(`NewAPI did not return key for token ${tokenId}`);
  }
  return key;
}

/**
 * Ensure a NewAPI token named by email exists; return { tokenId, apiKey }.
 * Creates once at registration with NEWAPI_TOKEN_QUOTA (default 200).
 * Does not mint a replacement key on later logins when quota is exhausted.
 */
export async function ensureNewApiTokenForEmail(email) {
  if (!env.newApiBaseUrl || !env.newApiAccessToken || !env.newApiUserId) {
    throw new Error(
      "NewAPI is not configured (NEWAPI_BASE_URL / NEWAPI_ACCESS_TOKEN / NEWAPI_USER_ID)",
    );
  }

  const name = tokenNameFromEmail(email);
  let token = await findTokenByName(name);
  if (!token) {
    token = await createToken(name, env.newApiTokenQuota);
  }
  const apiKey = await revealTokenKey(token.id);
  return {
    tokenId: token.id,
    apiKey,
    name,
  };
}

/** Build hosted credentials for the MedPrism client. */
export function publicHostedCredentials({ apiKey, accessToken }) {
  if (env.hostedProxyBaseUrl && accessToken) {
    return {
      baseUrl: env.hostedProxyBaseUrl,
      apiKey: accessToken,
      model: env.hostedDefaultModel,
    };
  }
  return {
    baseUrl: env.newApiPublicBaseUrl,
    apiKey,
    model: env.hostedDefaultModel,
  };
}
