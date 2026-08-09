# P06 — Compile-Fix Workflow

**Status:** ⬜ Not started  
**Priority:** P1  
**Depends on:** P01 Patch、P02 Context、P03 CompileService  
**Blocks:** 稳定的 “Fix with AI”

---

## 1. 目标

让 Fix with AI 从：

> 把大段 compile log 扔给模型猜

升级为：

```text
Compile
  → 找 root error
  → 定位文件/行
  → 读取附近代码
  → AI 生成最小 Patch
  → Diff
  → Keep
  → Recompile
```

---

## 2. 关键约束

- 每次优先修一个 root error。
- Patch target 必须与诊断文件绑定。
- AI 不得因为日志里出现其他文件名就任意修改不相关文件。
- Keep 后必须能选择重新编译验证。
- 修复失败不是继续自动无限循环。

---

## 3. CompileDiagnostic

优化 `src/tools/parseCompileLog.ts`，先做到 V1 可用：

```ts
type CompileDiagnostic = {
  severity: "error" | "warning" | "info";
  message: string;
  path?: string;
  line?: number;
  isRootCause: boolean;
  raw?: string;
};
```

V1 不强制完整 TeX include stack，但至少要：

- 优先识别第一条 fatal/root error；
- 尽量提取 path；
- 尽量提取 line；
- 区分 error 和 warning。

---

## 4. 实施步骤

### Step 1 — CompileService 返回统一日志

P03 result 至少提供：

```text
ok
log
```

不要在 renderer 各处各自解析不同格式。

### Step 2 — Parser

- [ ] 识别常见 `! ...`。
- [ ] 识别 `l.<line>`。
- [ ] 识别 `file:line:` 类错误。
- [ ] 过滤部分明显级联错误。
- [ ] 返回第一 root error。
- [ ] parser 失败时允许 fallback 为“日志无法精确定位”。

### Step 3 — Source context

如果有 path + line：

发送：

- 目标文件
- 目标行前后有限行
- root error
- 必要的 preamble/custom command context

如果只有 activeFile：

只作为 fallback，必须在 UI 标记定位不确定。

### Step 4 — Fix Skill

Fix Skill 只输出：

- diagnosis summary
- minimal PatchSet

约束：

```text
Do not rewrite the whole file.
Prefer one minimal replace_text operation.
Do not change scientific prose unless required for compilation.
```

### Step 5 — Validate

依赖 P01：

- [ ] Patch path 与 root error path 一致，除非模型明确说明跨文件原因。
- [ ] oldText 唯一。
- [ ] base hash 一致。
- [ ] 不能 fallback EOF append。

### Step 6 — Recompile

Keep 后：

```text
Recompile
  ├─ success → mark fixed
  └─ failure → show new root error
```

不要无限自动迭代。V1 建议用户明确点击下一次 Fix，或最多自动一次 compile verification。

---

## 5. UI

Compile panel 最低显示：

- Root error
- File
- Line
- “View source”
- “Fix with AI”
- Diff
- Keep
- Recompile result

---

## 6. 测试 fixtures

至少准备：

- [ ] undefined control sequence。
- [ ] missing `}`。
- [ ] missing `\begin/\end`。
- [ ] missing file。
- [ ] bad citation/reference warning（不应当作 fatal）。
- [ ] package error。
- [ ] root error 在非 main file。
- [ ] parser 无法定位。
- [ ] AI patch stale。
- [ ] Keep 后 recompile success。
- [ ] Keep 后产生新 error。

---

## 7. Definition of Done

- [ ] Fix 从真实 CompileService 结果启动。
- [ ] 优先定位一个 root error。
- [ ] 模型收到错误附近源码，而不是只有大日志。
- [ ] Patch target 与诊断强绑定。
- [ ] Patch 走 P01。
- [ ] Keep 后可 recompile。
- [ ] 失败不会无限自动自修。
- [ ] 常见 fixture 测试通过。

---

## 8. 实施记录

- PR:
- Commit:
- Parser fixtures:
- Compile-fix pass rate:
- Master Plan 状态已更新: [ ]
