import { db } from "./db.mjs";
import { newId, nowIso } from "./crypto.mjs";
import { ensureNewApiTokenForEmail } from "./newapi.mjs";

export function findUserByEmail(email) {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.toLowerCase());
}

export function findUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

/** First verify = register; later = login. */
export function upsertUserByEmail(email) {
  const normalized = email.toLowerCase();
  const existing = findUserByEmail(normalized);
  const ts = nowIso();
  if (existing) {
    db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(
      ts,
      existing.id,
    );
    return findUserById(existing.id);
  }
  const displayName = normalized.split("@")[0] || "User";
  const user = {
    id: newId("u"),
    email: normalized,
    display_name: displayName,
    created_at: ts,
    last_login_at: ts,
  };
  db.prepare(
    `INSERT INTO users (id, email, display_name, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(user.id, user.email, user.display_name, user.created_at, user.last_login_at);
  return findUserById(user.id);
}

export function saveUserNewApiCredentials(userId, tokenId, apiKey) {
  db.prepare(
    `UPDATE users SET newapi_token_id = ?, newapi_api_key = ? WHERE id = ?`,
  ).run(tokenId, apiKey, userId);
  return findUserById(userId);
}

/**
 * Create or reuse NewAPI token named by email; persist on user row.
 * Registration mints one key with NEWAPI_TOKEN_QUOTA (default 200).
 * Later logins reuse the stored key and never auto-issue a replacement.
 */
export async function ensureUserNewApiKey(user) {
  if (user.newapi_api_key && user.newapi_token_id) {
    return {
      tokenId: user.newapi_token_id,
      apiKey: user.newapi_api_key,
      user,
    };
  }

  const created = await ensureNewApiTokenForEmail(user.email);
  const updated = saveUserNewApiCredentials(
    user.id,
    created.tokenId,
    created.apiKey,
  );
  return {
    tokenId: created.tokenId,
    apiKey: created.apiKey,
    user: updated,
  };
}
