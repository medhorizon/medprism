# P03 — Electron CompileService

**Status:** 🟨 Implemented; repository verification pending
**Priority:** P0（发布 Electron 安装包时）  
**Depends on:** 无  
**Blocks:** P06 Compile-Fix、P09 packaged app cleanup

---

## 1. 目标

让打包后的 MedPrism 在**没有 Vite、没有手工启动 `npm run compile:server`** 的情况下：

```text
Compile → Tectonic → PDF
```

编译失败则：

```text
Compile → structured error/log
```

---

## 2. 当前问题

重点检查：

- `src/lib/compileClient.ts`
- `vite.config.ts`
- `server/compile/`
- `electron/main.cjs`
- `electron/preload.cjs`
- `package.json`

当前 renderer 调 `/api/compile`，开发时由 Vite proxy 转发；Electron 打包后没有这个代理。

---

## 3. 目标链路

```text
Renderer
  → window.medprismDesktop.compile.run(...)
  → preload IPC
  → Electron main CompileService
  → Tectonic
  → result
  → Renderer PDF / log
```

不需要第一版引入复杂 worker framework。

---

## 4. IPC API

在 preload 暴露最小 API：

```ts
type CompileRequest = {
  files: Record<string, string>;
  mainFile: string;
};

type CompileResult =
  | {
      ok: true;
      jobId: string;
      pdfBase64: string;
      log: string;
    }
  | {
      ok: false;
      jobId: string;
      log: string;
      error?: string;
    };

window.medprismDesktop.compile = {
  run(request): Promise<CompileResult>,
  cancel(jobId): Promise<void>,
  isAvailable(): Promise<boolean>,
};
```

如果现有 Preview 已使用其他 PDF 表示方式，可以保持现状；关键是 IPC contract 明确。

---

## 5. 实施步骤

### Step 1 — 抽离 compile core

从 `server/compile/` 抽出与 HTTP 无关的核心函数：

```text
compileProject(request, signal) -> CompileResult
```

职责：

- 创建临时目录；
- 写入文本文件；
- 校验 main file；
- 调用 Tectonic；
- 收集 stdout/stderr；
- 返回 PDF；
- finally 清理。

HTTP server 只作为开发 adapter 调同一个 core。

### Step 2 — Electron Main CompileService

新增：

```text
electron/compile/service.cjs
electron/compile/runner.cjs
```

- [ ] 注册 compile IPC。
- [ ] 为每次编译生成 jobId。
- [ ] 保存 child process 句柄。
- [ ] 支持 cancel。
- [ ] 支持 timeout。
- [ ] `shell: false`。
- [ ] 参数数组化。
- [ ] finally 清理 temp。

### Step 3 — Preload

修改 `electron/preload.cjs`：

- [ ] 只暴露固定 compile API。
- [ ] 不暴露通用 shell/exec。
- [ ] 不暴露通用 ipc invoke。
- [ ] 做基本 payload shape 限制。

### Step 4 — Renderer client

修改 `src/lib/compileClient.ts`：

Electron 环境：

```text
window.medprismDesktop.compile.run
```

Web dev 环境可暂时继续：

```text
/api/compile
```

但必须明确 production Electron 不依赖 `/api/compile`。

### Step 5 — 错误与取消 UI

- [ ] Compile 按钮进入 loading。
- [ ] 提供 Cancel。
- [ ] 成功更新 PDF。
- [ ] 失败显示日志。
- [ ] timeout 显示明确错误。
- [ ] 连续点击 Compile 不产生无限并发任务。

---

## 6. 安全最低要求

- [ ] 不使用 `shell: true`。
- [ ] 不让 renderer 自定义 executable。
- [ ] mainFile 只能来自 request files 中的相对路径。
- [ ] 拒绝明显路径穿越。
- [ ] 临时目录唯一。
- [ ] 编译有 timeout。
- [ ] 可取消 child process。
- [ ] stdout/stderr 有大小上限或合理截断。
- [ ] HTTP compile server 不作为 production 必需组件。

---

## 7. 测试

### Core test

- [ ] minimal article。
- [ ] syntax error。
- [ ] missing file。
- [ ] timeout fixture。
- [ ] cancel。
- [ ] nested `.tex`。
- [ ] bibliography 基础 fixture。

### Packaged smoke test

真实安装包：

1. 不启动 Vite。
2. 不启动 `npm run compile:server`。
3. 启动 MedPrism。
4. 打开应用内 fixture。
5. Compile。
6. 看见 PDF。
7. 制造错误。
8. 看见 log。

---

## 8. Definition of Done

- [ ] Electron packaged app 可独立编译。
- [ ] 成功返回 PDF。
- [ ] 失败返回 log。
- [ ] cancel 可用。
- [ ] timeout 可用。
- [ ] temp 正常清理。
- [ ] production 不依赖 Vite proxy。
- [ ] production 不需要 localhost compile service。

---

## 9. 实施记录

- PR:
- Commit:
- Packaged smoke test 平台:
- 已知限制:
- Master Plan 状态已更新: [ ]
