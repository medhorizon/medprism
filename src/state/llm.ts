import type { LlmConfig } from "../lib/llmClient";
import { isUsableLlmConfig } from "../lib/llmClient";
import { loadAuth } from "./auth";

const STORAGE_KEY = "medprism.llm";

export function loadLlmConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { mode: "mock" };
    const parsed = JSON.parse(raw) as LlmConfig;
    if (parsed?.mode === "custom" && isUsableLlmConfig(parsed)) {
      return parsed;
    }
    return { mode: "mock" };
  } catch {
    return { mode: "mock" };
  }
}

export function saveLlmConfig(config: LlmConfig) {
  if (config.mode === "custom") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    return;
  }
  if (config.mode === "mock") {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function clearCustomLlmConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasCustomLlmConfig(): boolean {
  return loadLlmConfig().mode === "custom";
}

/**
 * Resolve active LLM config for Assistant:
 * 1) user custom override (wins until next login clears it)
 * 2) authenticated hosted credentials
 * 3) mock / not configured
 */
export function resolveLlmConfig(): LlmConfig {
  const custom = loadLlmConfig();
  if (custom.mode === "custom" && isUsableLlmConfig(custom)) {
    return custom;
  }

  const auth = loadAuth();
  if (auth.status === "authenticated") {
    // Prefer auth /v1 proxy with the session access token. The auth server then
    // forwards with the user's NewAPI key (no global UPSTREAM_* required).
    const authBase = (
      import.meta.env.VITE_AUTH_BASE_URL as string | undefined
    )?.replace(/\/+$/, "");
    if (authBase && auth.accessToken) {
      return {
        mode: "hosted",
        baseUrl: `${authBase}/v1`,
        apiKey: auth.accessToken,
        model: auth.hosted.model || "deepseek-v4-flash",
      };
    }
    return {
      mode: "hosted",
      baseUrl: auth.hosted.baseUrl,
      apiKey: auth.hosted.apiKey,
      model: auth.hosted.model,
    };
  }

  return { mode: "mock" };
}
