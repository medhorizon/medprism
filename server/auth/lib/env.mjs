import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadDotEnv() {
  const path = join(root, ".env");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

function num(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  port: num("AUTH_PORT", 8787),
  tokenSecret: process.env.AUTH_TOKEN_SECRET || "dev-change-me",
  codeTtlSec: num("AUTH_CODE_TTL_SEC", 300),
  codeCooldownSec: num("AUTH_CODE_COOLDOWN_SEC", 60),
  codeMaxPerHour: num("AUTH_CODE_MAX_PER_HOUR", 5),
  tokenTtlSec: num("AUTH_TOKEN_TTL_SEC", 86400),
  refreshTokenTtlSec: num("AUTH_REFRESH_TTL_SEC", 60 * 60 * 24 * 90),
  mailMode: process.env.MAIL_MODE || "console",
  resendApiKey: (process.env.RESEND_API_KEY || "").trim(),
  mailFrom: (process.env.MAIL_FROM || "").trim(),
  /** When true, log OTP plaintext even for resend (dev only). */
  mailDebug: process.env.MAIL_DEBUG === "1",
  /** Comma-separated allowlist. Include `null` for Electron file:// clients. */
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  get corsOrigin() {
    return this.corsOrigins[0] || "http://localhost:5173";
  },
  hostedDefaultModel: process.env.HOSTED_DEFAULT_MODEL || "deepseek-v4-flash",
  /** NewAPI management root, e.g. https://newapi.medhorizon.icu */
  newApiBaseUrl: (process.env.NEWAPI_BASE_URL || "").replace(/\/+$/, ""),
  /** Public OpenAI-compatible base for MedPrism clients */
  newApiPublicBaseUrl: (
    process.env.NEWAPI_PUBLIC_BASE_URL ||
    process.env.HOSTED_BASE_URL ||
    "http://localhost:8787/v1"
  ).replace(/\/+$/, ""),
  newApiAccessToken: (process.env.NEWAPI_ACCESS_TOKEN || "").trim(),
  /** Must be numeric user id matching the access token owner */
  newApiUserId: (process.env.NEWAPI_USER_ID || "").trim(),
  newApiTokenQuota: num("NEWAPI_TOKEN_QUOTA", 2000),
  upstreamBaseUrl: (process.env.UPSTREAM_BASE_URL || "").trim(),
  upstreamApiKey: (process.env.UPSTREAM_API_KEY || "").trim(),
  dataDir: join(root, "data"),
  dbPath: join(root, "data", "auth.sqlite"),
};
