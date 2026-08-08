/** Auth state — session credentials + long-lived refreshToken for passwordless re-login. */

import {
  loginWithEmail,
  logoutRemote,
  refreshSession,
  verifyCode,
  type HostedCredentials,
} from "../lib/authApi";

const LLM_STORAGE_KEY = "medprism.llm";

export type AuthStatus = "guest" | "authenticated";

export type AuthState =
  | { status: "guest" }
  | {
      status: "authenticated";
      displayName: string;
      contact: string;
      accessToken?: string;
      refreshToken?: string;
      hosted: HostedCredentials;
    };

const SESSION_KEY = "medprism.auth.session";
const REFRESH_KEY = "medprism.auth.refresh";
const LEGACY_LOCAL_KEY = "medprism.auth";

export function loadRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function saveRefreshToken(token: string | null) {
  try {
    if (!token) localStorage.removeItem(REFRESH_KEY);
    else localStorage.setItem(REFRESH_KEY, token);
  } catch {
    /* ignore */
  }
}

export function loadAuth(): AuthState {
  try {
    localStorage.removeItem(LEGACY_LOCAL_KEY);
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return { status: "guest" };
    const parsed = JSON.parse(raw) as AuthState;
    if (parsed.status === "authenticated" && parsed.hosted?.baseUrl && parsed.hosted?.apiKey) {
      return parsed;
    }
    return { status: "guest" };
  } catch {
    return { status: "guest" };
  }
}

export function saveAuth(state: AuthState) {
  if (state.status === "guest") {
    sessionStorage.removeItem(SESSION_KEY);
    return;
  }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
}

export function clearAuth() {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(LEGACY_LOCAL_KEY);
  saveRefreshToken(null);
}

export function continueAsGuest(): AuthState {
  const state: AuthState = { status: "guest" };
  saveAuth(state);
  return state;
}

export function signOut(): AuthState {
  const current = loadAuth();
  const refresh = loadRefreshToken() || undefined;
  if (current.status === "authenticated") {
    void logoutRemote({
      accessToken: current.accessToken,
      refreshToken: refresh || current.refreshToken,
    });
  }
  clearAuth();
  return { status: "guest" };
}

function persistAuthenticated(result: {
  user: { email: string; displayName: string };
  accessToken: string;
  refreshToken: string;
  credentials: HostedCredentials;
}): AuthState {
  const state: AuthState = {
    status: "authenticated",
    contact: result.user.email,
    displayName: result.user.displayName || "User",
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    hosted: result.credentials,
  };
  // Login re-applies hosted credentials and clears any user custom override.
  try {
    localStorage.removeItem(LLM_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  saveAuth(state);
  saveRefreshToken(result.refreshToken);
  return state;
}

/** Register / first-time: verify code, create NewAPI key, store refreshToken. */
export async function signInWithCode(args: {
  contact: string;
  code: string;
}): Promise<{ ok: true; state: AuthState } | { ok: false; error: string }> {
  const result = await verifyCode(args);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, state: persistAuthenticated(result) };
}

/** Login without OTP: email must already be registered on the auth server. */
export async function signInWithEmail(contact: string): Promise<
  { ok: true; state: AuthState } | { ok: false; error: string }
> {
  const result = await loginWithEmail(contact);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, state: persistAuthenticated(result) };
}

/** Passwordless re-login using stored refreshToken; fetches apiKey from server. */
export async function signInWithRefresh(
  refreshToken?: string | null,
): Promise<{ ok: true; state: AuthState } | { ok: false; error: string }> {
  const token = (refreshToken ?? loadRefreshToken() ?? "").trim();
  if (!token) return { ok: false, error: "invalid_refresh" };
  const result = await refreshSession(token);
  if (!result.ok) {
    if (result.error === "invalid_refresh") saveRefreshToken(null);
    return { ok: false, error: result.error };
  }
  return { ok: true, state: persistAuthenticated(result) };
}

export function hasRefreshToken(): boolean {
  return Boolean(loadRefreshToken());
}
