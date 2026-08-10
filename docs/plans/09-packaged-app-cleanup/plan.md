# P09 — Electron 发布版清理

**Status:** ⬜ Not started  
**Priority:** P1  
**Depends on:** P03 Electron CompileService  
**Blocks:** 可靠 packaged release

---

## 1. 目标

修掉几项“开发模式看起来正常，但安装包可能误导或失效”的问题：

1. BrowserRouter + `file://` 风险。
2. 非 demo 项目显示固定 Sepsis 假预览。
3. 生产版残留 localhost compile 依赖/攻击面。
4. Compile 状态不清晰。

---

## 2. 路由

重点检查：

- `src/app/App.tsx`
- `electron/main.cjs`

V1 优先简单方案：

- [x] Electron packaged app 使用 `HashRouter`，或已经验证安全的自定义协议。
- [ ] `/projects`
- [ ] `/p/:projectId`
- [ ] 登录页
- [ ] 刷新/重启

都能正常打开。

不要只验证 `npm run dev`。

---

## 3. Preview

修改 `src/components/PreviewPane.tsx`：

移除普通项目中的固定 sepsis 数字/医学结论。

状态机最低：

```ts
type PreviewStatus =
  | "never"
  | "dirty"
  | "compiling"
  | "ready"
  | "failed";
```

显示：

- never: “尚未编译”
- dirty: “源文件已修改，需要重新编译”
- compiling: progress
- ready: PDF
- failed: error/log entry

如果保留 demo 项目，必须持续显示：

```text
DEMO / SYNTHETIC DATA
```

---

## 4. 生产 Compile 路径

P03 完成后：

- [ ] packaged Electron 只走 IPC CompileService。
- [ ] `/api/compile` 仅允许 dev web 模式。
- [ ] 独立 HTTP compile server 默认不随 production 启动。
- [ ] 文档明确 dev-only。
- [ ] 若保留 server，至少绑定 loopback，避免 CORS `*` 的默认生产暴露。

---

## 5. Electron 外链/基础安全

保持并核验：

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`

增加：

- [ ] `setWindowOpenHandler`。
- [ ] 拒绝 `javascript:` / 非预期 `file:` URL。
- [ ] 只允许明确外部 http/https 行为。
- [ ] preload 不暴露通用执行能力。

---

## 6. Packaged smoke test

至少：

- [ ] 安装包启动。
- [ ] projects route。
- [ ] 打开 project route。
- [ ] 刷新/重启。
- [ ] Preview 初始无假论文结果。
- [ ] Compile success。
- [ ] Compile failure。
- [ ] 不启动 localhost compile server。
- [ ] 无 Vite。

---

## 7. Definition of Done

- [ ] packaged route 稳定。
- [ ] 非 demo 无固定 Sepsis 假预览。
- [ ] Preview 有真实状态。
- [ ] production compile 不依赖 HTTP localhost。
- [ ] preload 仍为最小权限。
- [ ] packaged smoke test 通过。

---

## 8. 实施记录

- PR:
- Commit:
- Tested platform:
- Master Plan 状态已更新: [ ]
