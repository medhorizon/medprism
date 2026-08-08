# Plan01 · 完成状态（登录鉴权 + 访客 API + 真实验证码 + NewAPI）

> **状态：✅ 已完成**（2026-08-08）  
> 详规见 [PLAN01-REAL-AUTH.md](./PLAN01-REAL-AUTH.md)；总路线图见 [PLAN.md](./PLAN.md)。

---

## 已交付能力

| 能力 | 说明 |
|---|---|
| 登录页 | 邮箱验证码登录 / 快速登录 / 访客继续 |
| 真实验证码 | Resend 发信（`MAIL_MODE=resend`） |
| NewAPI 自动发 Key | 首次验证通过后按邮箱创建令牌（额度 2000，永不过期） |
| 自动配置 | 登录后写入 hosted `baseUrl` + `apiKey`（`https://newapi.medhorizon.icu/v1`） |
| 免验证码再登录 | `refreshToken`（localStorage）→ `POST /auth/refresh` |
| 访客 | 可关闭 Provider 弹窗，自填 Base URL / API Key |
| Assistant | 使用当前 hosted / custom 配置调用 OpenAI-compatible API |

---

## 阶段勾选

- [x] **Stub UI**（Plan1 壳：登录/访客、session 状态）
- [x] **阶段 A**：`server/auth` + SQLite + OTP stub/console + 前端接线
- [x] **阶段 B**：Resend 真发信（已收件验收）
- [x] **阶段 D**：NewAPI 建 key + refresh 快速登录（已联调）

---

## 本地怎么跑（复测）

```bash
# 终端 1
npm run auth:server

# 终端 2
npm run dev
```

- 前端：`http://localhost:5173`（以 Vite 实际端口为准）
- Auth：`http://localhost:8787`
- 配置：`server/auth/.env`（勿提交）、根目录 `.env` 含 `VITE_AUTH_BASE_URL`

### 建议复测路径

1. 打开 `/login` → 邮箱验证码登录 → 进 `/projects`，确认 hosted API 提示  
2. 进工作区发一条 Assistant 消息（应走 NewAPI）  
3. 关闭浏览器再开 → 「快速登录」免验证码取回同一配置  
4. 注销后再走访客 + Provider 弹窗自填  

---

## 关键文件

- `src/pages/LoginPage.tsx` / `src/state/auth.ts` / `src/lib/authApi.ts`
- `src/components/ProviderSettingsModal.tsx` / `src/state/llm.ts` / `src/lib/llmClient.ts`
- `server/auth/`（`index.mjs`、`lib/newapi.mjs`、`.env`）
- `docs/auth-setup.md`

---

## 未纳入 Plan01（后续）

- 用户 NewAPI key 不下发浏览器、仅走服务端代理（更安全）
- 短信验证码、OAuth
- Streaming / 完整 Hosted-Custom 设置面板 Mode 切换 UI
