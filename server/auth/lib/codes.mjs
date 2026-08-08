import { db } from "./db.mjs";
import {
  addSecondsIso,
  hashValue,
  newId,
  nowIso,
  randomOtpCode,
  safeEqualHex,
} from "./crypto.mjs";
import { env } from "./env.mjs";
import { sendVerificationCode } from "./mail.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(contact) {
  return String(contact || "").trim().toLowerCase();
}

export function isValidEmail(email) {
  return EMAIL_RE.test(email);
}

export function checkRateLimit(email) {
  const now = Date.now();
  const cooldownSince = new Date(now - env.codeCooldownSec * 1000).toISOString();
  const hourSince = new Date(now - 3600 * 1000).toISOString();

  const recent = db
    .prepare(
      `SELECT sent_at FROM otp_send_log
       WHERE email = ? AND sent_at >= ?
       ORDER BY sent_at DESC LIMIT 1`,
    )
    .get(email, cooldownSince);
  if (recent) {
    return { ok: false, error: "rate_limited" };
  }

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM otp_send_log
       WHERE email = ? AND sent_at >= ?`,
    )
    .get(email, hourSince);
  if ((countRow?.c ?? 0) >= env.codeMaxPerHour) {
    return { ok: false, error: "rate_limited" };
  }

  return { ok: true };
}

export async function issueCode(email) {
  const rate = checkRateLimit(email);
  if (!rate.ok) return rate;

  const code = randomOtpCode();
  const id = newId("otp");
  const createdAt = nowIso();
  const expiresAt = addSecondsIso(env.codeTtlSec);

  db.prepare(
    `INSERT INTO otp_codes (id, email, code_hash, expires_at, consumed_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`,
  ).run(id, email, hashValue(code), expiresAt, createdAt);

  db.prepare(
    `INSERT INTO otp_send_log (id, email, sent_at) VALUES (?, ?, ?)`,
  ).run(newId("send"), email, createdAt);

  await sendVerificationCode({ email, code });
  return { ok: true };
}

export function consumeCode(email, code) {
  const row = db
    .prepare(
      `SELECT * FROM otp_codes
       WHERE email = ? AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(email);

  if (!row) return { ok: false, error: "invalid_code" };
  if (row.expires_at < nowIso()) {
    return { ok: false, error: "invalid_code" };
  }
  if (!safeEqualHex(row.code_hash, hashValue(String(code || "").trim()))) {
    return { ok: false, error: "invalid_code" };
  }

  db.prepare(`UPDATE otp_codes SET consumed_at = ? WHERE id = ?`).run(
    nowIso(),
    row.id,
  );
  return { ok: true };
}
