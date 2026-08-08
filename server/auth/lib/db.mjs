import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { env } from "./env.mjs";

mkdirSync(env.dataDir, { recursive: true });

export const db = new DatabaseSync(env.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_login_at TEXT,
    newapi_token_id INTEGER,
    newapi_api_key TEXT
  );

  CREATE TABLE IF NOT EXISTS otp_codes (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS access_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS otp_send_log (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    sent_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_otp_codes_email ON otp_codes(email);
  CREATE INDEX IF NOT EXISTS idx_otp_send_log_email_sent ON otp_send_log(email, sent_at);
  CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
`);

function columnExists(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((row) => row.name === column);
}

if (!columnExists("users", "newapi_token_id")) {
  db.exec(`ALTER TABLE users ADD COLUMN newapi_token_id INTEGER`);
}
if (!columnExists("users", "newapi_api_key")) {
  db.exec(`ALTER TABLE users ADD COLUMN newapi_api_key TEXT`);
}
