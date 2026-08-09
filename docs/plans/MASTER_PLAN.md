# MedPrism V1 优化总控计划

> 目标仓库：`medhorizon/medprism`  
> 目标分支基线：`cursor/plan06-skill-routing`  
> 适用范围：本地 Science 写作、LaTeX 修改、引用、编译与 AI 辅助  
> 本文只负责**统筹进度与依赖关系**。具体实现细节以各子目录的 `plan.md` 为准。

---

## 0. 固定产品决策

以下决策已经确认，后续子计划不得擅自推翻：

- [x] 保留“输入邮箱即可进入”的快捷登录体验。
- [x] V1 继续允许 JSON + `localStorage` 保存 `.tex/.bib/.sty/.cls` 等纯文本项目。
- [x] 必须彻底移除 `.tex` AI 建议直接追加到文件末尾的行为。
- [x] 如果发布 Electron 安装包并提供 Compile，则安装包必须脱离 Vite/独立 compile server 自行编译。
- [x] V1 优先补 `activeFile / selection / selectedText`，不先建设复杂全文 Context Engine。
- [x] Skill 优化采用轻量、确定性的 workflow orchestration，不先做通用 Planner/DAG。
- [x] filesystem、SQLite、Skill Marketplace、通用 Planner 属于后续按真实需求升级项。

---

## 1. V1 最终核心链路

```text
用户打开/选择论文内容
  → AI 知道 activeFile / selection
  → Router 进入确定 Workflow
  → 当前 Skill 生成 Typed Result / Patch
  → Patch Validator 校验
  → Diff
  → Keep
  → 必要时 Electron CompileService 编译
  → PDF / Error
  → Undo 或下一次 Fix
```

V1 是否成功，优先看这条链路是否可靠，而不是 Skill 数量或 Prompt 长度。

---

## 2. 执行顺序

| ID | Plan | 优先级 | 依赖 | 状态 |
|---|---|---:|---|---|
| P01 | [Typed Patch / 原位替换](./01-patch-engine/plan.md) | P0 | 无 | ⬜ Not started |
| P02 | [activeFile / Selection 上下文](./02-context-selection/plan.md) | P0 | P01 可并行开发，联调依赖 P01 | ⬜ Not started |
| P03 | [Electron CompileService](./03-electron-compile-service/plan.md) | P0 | 无；Fix 联调依赖 P01 | ⬜ Not started |
| P04 | [localStorage 稳定性与真实导出](./04-localstorage-hardening/plan.md) | P1 | 无 | ⬜ Not started |
| P05 | [Citation Workflow](./05-citation-workflow/plan.md) | P1 | P01、P02 | ⬜ Not started |
| P06 | [Compile-Fix Workflow](./06-compile-fix-workflow/plan.md) | P1 | P01、P02、P03 | ⬜ Not started |
| P07 | [Skill / Prompt / Router 收敛](./07-skill-prompt-workflows/plan.md) | P1 | P01、P02；可与 P05/P06 逐步联调 | ⬜ Not started |
| P08 | [快捷登录风险隔离](./08-quick-login-risk-control/plan.md) | P1 | 无 | ⬜ Not started |
| P09 | [Electron 发布版清理](./09-packaged-app-cleanup/plan.md) | P1 | P03 | ⬜ Not started |
| P10 | [测试、E2E 与 Release Gate](./10-testing-release-gates/plan.md) | P1 | 持续进行；最终依赖 P01–P09 | ⬜ Not started |
| B01 | [V2 / 延后事项](./90-v2-backlog/plan.md) | Backlog | V1 稳定后 | ⬜ Deferred |

---

## 3. 建议并行方式

可以并行：

```text
Track A: P01 Patch → P05 Citation → P06 Compile-Fix
Track B: P02 Context ───────────────┘
Track C: P03 Compile → P09 Packaged App
Track D: P04 Storage
Track E: P08 Login Risk Control
```

P07 不建议等所有计划结束后再一次性重构。应在 P05/P06 落地时同步把对应 Skill/Prompt 收敛到新 Workflow。

P10 从 P01 开始就持续补测试，最后再集中补 packaged E2E 和 release gate。

---

## 4. 里程碑

### Milestone A — AI 能“改对地方”

包含：

- [ ] P01 Typed Patch 完成。
- [ ] P02 activeFile / selection 完成。
- [ ] 选区 → AI → Diff → Keep → Undo 的集成测试通过。

**里程碑验收：**

- `.tex` 正文不再存在 EOF append 路径。
- “只改选区”不会修改选区外内容。
- stale / ambiguous patch 必须拒绝 Keep。

---

### Milestone B — 安装版能真正编译

包含：

- [ ] P03 Electron CompileService 完成。
- [ ] P09 packaged app 的路由/Preview/旧 HTTP 编译路径清理完成。
- [ ] 安装包在没有 Vite 和独立 compile server 时能生成 PDF。

**里程碑验收：**

```text
编辑 → Compile → PDF
错误 → Log
```

在真实 packaged Electron 中成立。

---

### Milestone C — 4 条核心 Workflow 成立

包含：

- [ ] P05 Citation workflow。
- [ ] P06 Compile-Fix workflow。
- [ ] P07 writing/polish/review + Prompt/Router/Skill 收敛。

**里程碑验收：**

至少四条流程可独立测试：

- writing/polish
- citation
- compile-fix
- review

不再依靠“同时注入多份 Skill 文本，让模型自己猜执行顺序”。

---

### Milestone D — V1 可长期自用/小范围分发

包含：

- [ ] P04 localStorage 加固。
- [ ] P08 快捷登录风险隔离。
- [ ] P10 测试与 Release Gate。
- [ ] 真正 Export。
- [ ] 崩溃/容量/编译失败都有用户可见行为。

---

## 5. V1 Release Gate

以下项目全部满足，才建议把版本定义为“可日常使用”：

### 编辑正确性

- [ ] 100% AI `.tex` 修改走 typed patch。
- [ ] 不存在把正文 suggestion 直接 append 到 EOF 的生产代码。
- [ ] `oldText/anchor` 不唯一时拒绝 Keep。
- [ ] Diff 在 Keep 前可见。
- [ ] Undo 可恢复 Keep 前内容。
- [ ] selection 限定任务 0 次越界。

### 上下文

- [ ] activeFile 传入 runtime。
- [ ] selection 与 selectedText 一致。
- [ ] compile-fix 读取真实报错文件附近代码。
- [ ] review 披露读取范围。

### 编译

- [ ] packaged Electron 无 Vite 可编译。
- [ ] 成功返回 PDF。
- [ ] 失败返回 log。
- [ ] 支持 timeout/cancel。
- [ ] 不要求用户手工启动独立 compile server。

### 数据

- [ ] 保存有 debounce。
- [ ] project 使用 per-project key。
- [ ] 有 `schemaVersion`。
- [ ] 保存失败有明确提示。
- [ ] 有 recovery snapshot。
- [ ] Export TEX/ZIP 真实可用。

### 快捷登录

- [ ] 继续支持邮箱快捷登录。
- [ ] renderer 不持有长期 provider secret。
- [ ] 有 quota / rate limit。
- [ ] session 可吊销。
- [ ] 普通快捷账号没有管理员/密钥管理权限。

### Workflow / 科研可信度

- [ ] Citation 写入前验证 metadata。
- [ ] `.bib` 去重，cite-key 冲突不覆盖旧条目。
- [ ] Compile-Fix patch 绑定 root error 的目标文件。
- [ ] Review 默认不直接改稿。
- [ ] 不根据标题单独声称论文“支持”具体科学结论。

---

## 6. 状态维护规则

每完成一个子计划：

1. 更新该子计划顶部 `Status`。
2. 勾选该子计划的 Definition of Done。
3. 在本文件第 2 节把状态改为：
   - `🟨 In progress`
   - `🟩 Done`
   - `🟥 Blocked`
4. 把实际 PR / commit 链接记录在子计划的“实施记录”中。
5. 若实现与计划不同，先更新子计划，再继续编码，避免文档永久失真。

---

## 7. 不进入 V1 主线的事项

以下统一放入 `90-v2-backlog/plan.md`，不得阻塞 P01–P10：

- 全量真实 filesystem 项目层。
- SQLite 项目数据库。
- Git UI。
- 大规模 binary figure 管理。
- 通用全文语义索引。
- Skill Manifest / Marketplace。
- 通用 Planner / DAG Engine。
- 多模型自动 handoff。
- 完全离线本地模型。
- 协作、评论、语音、白板。

---

## 8. 推荐第一个开发批次

如果一次只开 3 个任务：

1. `01-patch-engine/plan.md`
2. `02-context-selection/plan.md`
3. `03-electron-compile-service/plan.md`

这三项完成后，MedPrism 的关键体验应达到：

```text
选中论文一段
→ AI 知道位置
→ 精确原位修改
→ Diff / Keep
→ Electron 本地编译
→ PDF 验证
```
