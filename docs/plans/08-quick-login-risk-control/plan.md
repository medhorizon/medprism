# P08 — 保留快捷登录，同时限制风险范围

**Status:** ⬜ Not started  
**Priority:** P1  
**Depends on:** 无  
**Product decision:** **不得把“删除邮箱快捷登录”作为本计划目标。**

---

## 1. 目标

保留：

```text
输入邮箱 → 快捷进入 MedPrism
```

同时做到：

> 即使有人知道一个已注册邮箱并进入普通账号，也拿不到长期 Provider Secret、不能无限烧额度、不能获得管理员能力，并且 session 可以吊销。

---

## 2. 明确接受的风险

仅凭邮箱不能证明“当前操作者就是邮箱本人”。

这是产品有意接受的低保证身份模式。

本计划不是消除这个事实，而是降低账号被冒用时的最大损失。

---

## 3. 必须隔离的高价值能力

普通快捷登录不得直接获得：

- 长期 OpenAI/NewAPI/provider secret
- 管理员权限
- 用户管理
- Provider key 管理
- 无限模型额度
- 不可吊销的长期 session

---

## 4. 实施步骤

### Step 1 — Renderer 不持有长期 provider key

检查：

- `server/auth/lib/newapi.mjs`
- `server/auth/index.mjs`
- `src/state/auth.ts`
- `src/state/llm.ts`

目标：

```text
Renderer → MedPrism session
Server/Trusted side → provider secret
```

- [ ] login response 不返回可直接调用上游的长期 secret。
- [ ] localStorage/sessionStorage 不保存该 secret。
- [ ] DevTools 中普通会话对象不包含该 secret。

如果当前模型调用架构暂时要求 renderer 直连 provider，则至少单独记录为 blocker，不能假装已经隔离完成。

### Step 2 — Quota

每账号至少有：

```ts
dailyRequestLimit
dailyTokenOrCostLimit
```

超限明确返回 quota error。

### Step 3 — Rate limit

最低：

- 登录接口 rate limit
- 模型调用 rate limit
- 文献搜索可单独 rate limit

### Step 4 — Session revoke

- [ ] session/token 有 id。
- [ ] 服务端能标记 revoked。
- [ ] 用户/管理员可注销当前 session。
- [ ] 至少提供“注销全部会话”的后台能力。

### Step 5 — Token 生命周期

- [ ] access token 有合理有效期。
- [ ] refresh 流程可吊销。
- [ ] 不使用永久 token。

### Step 6 — 管理能力分离

管理员入口不得只依靠普通邮箱快捷登录。

可选：

- 独立 admin secret
- 后台环境变量保护
- 单独 OAuth/OTP
- 本地-only admin operation

具体方案可根据部署规模选择，但权限必须分层。

### Step 7 — 异常消费保护

至少记录：

- account id
- session id
- timestamp
- request count
- token/cost usage

不默认记录论文全文。

超过异常阈值可冻结托管模型额度。

---

## 5. UI 保持简单

普通用户仍然看到：

```text
Email → Continue
```

不要为了安全实现把 UI 变成复杂注册流程。

如果 session 被吊销/额度超限，提供可理解提示。

---

## 6. 测试

- [ ] 已注册邮箱仍可快捷登录。
- [ ] 未注册邮箱行为符合当前产品规则。
- [ ] login response 无 provider secret。
- [ ] renderer storage 无 provider secret。
- [ ] quota 生效。
- [ ] rate limit 生效。
- [ ] revoke 后旧 session 失效。
- [ ] 普通用户无法访问 admin endpoint。
- [ ] 异常调用不会无限消耗额度。

---

## 7. Definition of Done

- [ ] 快捷邮箱登录保留。
- [ ] renderer 无长期 provider secret。
- [ ] account quota 有效。
- [ ] rate limit 有效。
- [ ] session 可吊销。
- [ ] admin/secret management 与普通快捷登录隔离。
- [ ] 最小 usage audit 不保存稿件正文。

---

## 8. 实施记录

- PR:
- Commit:
- Quota policy:
- Session TTL:
- Master Plan 状态已更新: [ ]
