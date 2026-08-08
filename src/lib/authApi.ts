/**
 * Auth API — real server by default; set VITE_AUTH_STUB=1 to use local stub.
 */

export const STUB_VERIFICATION_CODE = "123456";

export const STUB_HOSTED_CREDENTIALS = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-medprism-stub",
  model: "deepseek-v4-flash",
} as const;

export type HostedCredentials = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type AuthUser = {
  id?: string;
  email: string;
  displayName: string;
};

export type AuthSessionResult =
  | {
      ok: true;
      credentials: HostedCredentials;
      user: AuthUser;
      accessToken: string;
      refreshToken: string;
    }
  | {
      ok: false;
      error:
        | "invalid_code"
        | "invalid_contact"
        | "invalid_refresh"
        | "not_registered"
        | "network";
    };

export type RequestCodeResult =
  | { ok: true; stubHint?: string }
  | { ok: false; error: "invalid_contact" | "rate_limited" | "network" };

const AUTH_BASE = (import.meta.env.VITE_AUTH_BASE_URL as string | undefined)?.replace(
  /\/+$/,
  "",
);
const USE_STUB = import.meta.env.VITE_AUTH_STUB === "1" || !AUTH_BASE;

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function parseSessionPayload(
  data: {
    accessToken?: string;
    refreshToken?: string;
    hosted?: HostedCredentials;
    user?: { id?: string; email?: string; displayName?: string };
  },
  fallbackEmail: string,
): AuthSessionResult {
  if (
    !data.hosted?.baseUrl ||
    !data.hosted?.apiKey ||
    !data.accessToken ||
    !data.refreshToken
  ) {
    return { ok: false, error: "network" };
  }
  const contact = data.user?.email || fallbackEmail;
  return {
    ok: true,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    credentials: {
      baseUrl: data.hosted.baseUrl,
      apiKey: data.hosted.apiKey,
        model: data.hosted.model || "deepseek-v4-flash",
    },
    user: {
      id: data.user?.id,
      email: contact,
      displayName:
        data.user?.displayName ||
        (contact.includes("@") ? contact.split("@")[0]! : contact) ||
        "User",
    },
  };
}

async function stubRequestCode(contact: string): Promise<RequestCodeResult> {
  const trimmed = contact.trim();
  if (!trimmed) return { ok: false, error: "invalid_contact" };
  await delay(280);
  return { ok: true, stubHint: STUB_VERIFICATION_CODE };
}

async function stubSession(contact: string): Promise<AuthSessionResult> {
  const local = contact.includes("@") ? contact.split("@")[0]! : contact;
  return {
    ok: true,
    credentials: { ...STUB_HOSTED_CREDENTIALS },
    accessToken: STUB_HOSTED_CREDENTIALS.apiKey,
    refreshToken: `stub-refresh-${crypto.randomUUID()}`,
    user: {
      email: contact,
      displayName: local || "User",
    },
  };
}

export async function requestCode(contact: string): Promise<RequestCodeResult> {
  if (USE_STUB) return stubRequestCode(contact);

  const trimmed = contact.trim();
  if (!trimmed) return { ok: false, error: "invalid_contact" };

  try {
    const res = await fetch(`${AUTH_BASE}/auth/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact: trimmed }),
    });
    if (res.status === 202) return { ok: true };
    if (res.status === 429) return { ok: false, error: "rate_limited" };
    if (res.status === 400) return { ok: false, error: "invalid_contact" };
    return { ok: false, error: "network" };
  } catch {
    return { ok: false, error: "network" };
  }
}

export async function verifyCode(args: {
  contact: string;
  code: string;
}): Promise<AuthSessionResult> {
  const contact = args.contact.trim();
  const code = args.code.trim();
  if (!contact) return { ok: false, error: "invalid_contact" };
  if (!code) return { ok: false, error: "invalid_code" };

  if (USE_STUB) {
    if (code !== STUB_VERIFICATION_CODE) return { ok: false, error: "invalid_code" };
    await delay(320);
    return stubSession(contact);
  }

  try {
    const res = await fetch(`${AUTH_BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact, code }),
    });
    if (res.status === 401) return { ok: false, error: "invalid_code" };
    if (res.status === 400) return { ok: false, error: "invalid_contact" };
    if (!res.ok) return { ok: false, error: "network" };
    return parseSessionPayload(await res.json(), contact);
  } catch {
    return { ok: false, error: "network" };
  }
}

/** Login without verification code — email must already be registered. */
export async function loginWithEmail(contact: string): Promise<AuthSessionResult> {
  const email = contact.trim();
  if (!email) return { ok: false, error: "invalid_contact" };

  if (USE_STUB) {
    await delay(280);
    return stubSession(email);
  }

  try {
    const res = await fetch(`${AUTH_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact: email }),
    });
    if (res.status === 404) return { ok: false, error: "not_registered" };
    if (res.status === 400) return { ok: false, error: "invalid_contact" };
    if (!res.ok) return { ok: false, error: "network" };
    return parseSessionPayload(await res.json(), email);
  } catch {
    return { ok: false, error: "network" };
  }
}

export async function refreshSession(refreshToken: string): Promise<AuthSessionResult> {
  const token = refreshToken.trim();
  if (!token) return { ok: false, error: "invalid_refresh" };

  if (USE_STUB) {
    await delay(200);
    return stubSession("stub@example.com");
  }

  try {
    const res = await fetch(`${AUTH_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: token }),
    });
    if (res.status === 401) return { ok: false, error: "invalid_refresh" };
    if (!res.ok) return { ok: false, error: "network" };
    return parseSessionPayload(await res.json(), "");
  } catch {
    return { ok: false, error: "network" };
  }
}

export async function logoutRemote(args: {
  accessToken?: string;
  refreshToken?: string;
}) {
  if (USE_STUB || !AUTH_BASE) return;
  try {
    await fetch(`${AUTH_BASE}/auth/logout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(args.accessToken
          ? { Authorization: `Bearer ${args.accessToken}` }
          : {}),
      },
      body: JSON.stringify({ refreshToken: args.refreshToken || "" }),
    });
  } catch {
    /* ignore */
  }
}

export function isAuthStubMode() {
  return USE_STUB;
}
