# Auth server setup (Plan01-Real · Phase A)

Email OTP login via Resend (`MAIL_MODE=resend`) or console logging (`MAIL_MODE=console`).

## Requirements

- Node.js **22.5+** (uses built-in `node:sqlite`)
- Two terminals: auth server + Vite
- For Resend: verified domain + `RESEND_API_KEY` + `MAIL_FROM`

## Run

```bash
# once
cp .env.example .env
cp server/auth/.env.example server/auth/.env
# edit server/auth/.env — set MAIL_MODE, RESEND_API_KEY, MAIL_FROM

# terminal 1 — auth + hosted LLM proxy
npm run auth:server

# terminal 2 — frontend
npm run dev
```

Frontend must set for local Vite:

```bash
VITE_AUTH_BASE_URL=http://localhost:8787
```

Packaged Electron / CI production builds read [`.env.production`](../.env.production) (`https://auth.medhorizon.icu`). Electron `file://` clients need `null` in the auth server `CORS_ORIGIN` allowlist.

## Login flow

1. Open `/login`
2. Enter an email → **获取验证码**
3. Read the 6-digit code from email (`MAIL_MODE=resend`) or auth server console (`console`)
4. Submit → session stored in `sessionStorage` with hosted `{ baseUrl, apiKey, model }`

## Resend (phase B)

```bash
# server/auth/.env
MAIL_MODE=resend
RESEND_API_KEY=re_...
MAIL_FROM=MedPrism <noreply@yourdomain.com>
MAIL_DEBUG=0
```

Never commit real keys. If a key was pasted into chat or a ticket, rotate it in the Resend dashboard.

## NewAPI auto key (current)

On successful OTP verify, auth server:

1. Creates (or reuses) a NewAPI token named by the user email (`remain_quota=200` by default, never expires)
2. Reveals the full key via `POST /api/token/batch/keys`
3. Returns `hosted.baseUrl` + `hosted.apiKey` for MedPrism auto-config
4. Issues a `refreshToken` (stored in browser `localStorage`) for passwordless re-login

```bash
# server/auth/.env
NEWAPI_BASE_URL=https://newapi.medhorizon.icu
NEWAPI_PUBLIC_BASE_URL=https://newapi.medhorizon.icu/v1
NEWAPI_ACCESS_TOKEN=...
NEWAPI_USER_ID=1          # numeric id matching the access token owner
NEWAPI_TOKEN_QUOTA=200
```

`POST /auth/refresh` with `{ refreshToken }` returns the same hosted credentials without OTP.

## Stub fallback

```bash
# .env
VITE_AUTH_STUB=1
# or omit VITE_AUTH_BASE_URL
```

Uses fixed code `123456` without the auth server.

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/code` | `{ contact }` → 202 |
| POST | `/auth/verify` | `{ contact, code }` → token + hosted |
| GET | `/auth/me` | Bearer token |
| POST | `/auth/logout` | revoke token |
| POST | `/v1/chat/completions` | Bearer token; proxies upstream when configured |

## Phase B

Real email delivery (`MAIL_MODE=resend` / `smtp`) — see [PLAN01-REAL-AUTH.md](../PLAN01-REAL-AUTH.md).
