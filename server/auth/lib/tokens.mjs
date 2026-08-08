import { db } from "./db.mjs";
import {
  addSecondsIso,
  hashValue,
  nowIso,
  randomToken,
} from "./crypto.mjs";
import { env } from "./env.mjs";
import { findUserById } from "./users.mjs";

export function issueAccessToken(userId) {
  const token = randomToken();
  const createdAt = nowIso();
  const expiresAt = addSecondsIso(env.tokenTtlSec);
  db.prepare(
    `INSERT INTO access_tokens (token_hash, user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(hashValue(token), userId, expiresAt, createdAt);
  return { token, expiresAt };
}

export function issueRefreshToken(userId) {
  const token = randomToken();
  const createdAt = nowIso();
  const expiresAt = addSecondsIso(env.refreshTokenTtlSec);
  db.prepare(
    `INSERT INTO refresh_tokens (token_hash, user_id, expires_at, created_at, revoked_at)
     VALUES (?, ?, ?, ?, NULL)`,
  ).run(hashValue(token), userId, expiresAt, createdAt);
  return { token, expiresAt };
}

export function resolveAccessToken(token) {
  if (!token) return null;
  const row = db
    .prepare(`SELECT * FROM access_tokens WHERE token_hash = ?`)
    .get(hashValue(token));
  if (!row) return null;
  if (row.expires_at < nowIso()) return null;
  const user = findUserById(row.user_id);
  if (!user) return null;
  return { user, tokenRow: row };
}

export function resolveRefreshToken(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .get(hashValue(token));
  if (!row) return null;
  if (row.expires_at < nowIso()) return null;
  const user = findUserById(row.user_id);
  if (!user) return null;
  return { user, tokenRow: row };
}

export function revokeAccessToken(token) {
  if (!token) return;
  db.prepare(`DELETE FROM access_tokens WHERE token_hash = ?`).run(
    hashValue(token),
  );
}

export function revokeRefreshToken(token) {
  if (!token) return;
  db.prepare(
    `UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?`,
  ).run(nowIso(), hashValue(token));
}

export function revokeAllRefreshTokensForUser(userId) {
  db.prepare(
    `UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
  ).run(nowIso(), userId);
}
