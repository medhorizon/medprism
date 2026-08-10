# Plan01–Plan06 实施报告

> 基线提交：`38572a413eca4a202da0ec621f0cd9a106726fe5`  
> 目标分支：`cursor/plan06-skill-routing`  
> 实施状态：**🟨 代码已完成；等待完整仓库 CI 与真实 Electron/Tectonic 验证**

## 1. 实施顺序

```text
P01.1 Patch 修复
  → P02 activeFile / selection
  → P03 Electron CompileService
  → P04 localStorage 稳定性
  → P05 Citation Workflow
  → P06 Compile-Fix Workflow
```

## 2. 状态摘要

| Plan | 当前结果 | 状态 |
|---|---|---|
| P01.1 | Patch 单一 simulation 内核、CAS Keep/Undo、精确 diff、typed error、`.tex` 结构保护 | 🟨 待仓库 CI |
| P02 | activeFile/selection ContextSnapshot、runtime 注入 hash/revision、选区越界保护 | 🟨 待真实 UI 冒烟 |
| P03 | Electron IPC CompileService、共享 compile core、取消/超时/限制/清理 | 🟨 待真实 Tectonic 与 packaged smoke |
| P04 | per-project localStorage、迁移、recovery、debounce、CAS、ZIP export、错误提示 | 🟨 待浏览器配额/恢复冒烟 |
| P05 | selection → Europe PMC → judgement → runtime BibTeX → atomic Patch | 🟨 待真实 API 与论文样本验证 |
| P06 | fresh compile → root diagnostic → scoped minimal Patch → one recompile | 🟨 待真实 LaTeX error corpus |

## 3. 已实现内容

### P01.1 — Patch Engine 修复

- 使用唯一 `simulatePatchSet()`；validate、preview、apply 共用同一执行语义。
- LLM 只输出 `ModelPatchProposal`；`baseSha256`、patch id 和 project revision 由 runtime 注入。
- exact path、safe path、project revision、file hash、唯一匹配与原子多操作。
- selection range 可精确替换重复文本。
- `.tex` 修改后验证首个有效 `\end{document}`；拒绝在其后新增正文或隐藏尾后正文。
- Undo 快照记录文件是否原本存在，新建 `.bib` Undo 会删除文件。
- Keep / Undo 使用 compare-and-swap，避免异步旧 React 闭包覆盖新输入。
- typed error 从 Patch 内核保留到 Workspace，不统一吞成 `BASE_MISMATCH`。
- Preview 使用 simulation 记录的精确 offset，不在修改后重新搜索文本。

### P02 — Active File / Selection

- `SourcePane` 上报 textarea 的 `selectionStart/selectionEnd`。
- `WorkspacePage` 保存 active file 和 selection，切换文件或编辑时清除旧 range。
- `ContextSnapshot` 记录 active file、selection、selected text、local context、file hash、project revision。
- selected text 始终由当前文件和 range 重新切片，不信任 UI 复制值。
- selection-scoped edit 只能替换准确选区，不能跨文件或使用 insert。
- 模型不再复制 hash；runtime 从 immutable snapshot hydrate PatchSet。

### P03 — Electron CompileService

- preload 只暴露 `compile.run/cancel/isAvailable`。
- Electron Main 的 `CompileService` 直接调用共享 compile core；生产版不依赖 Vite proxy。
- dev HTTP adapter 复用同一个 core，不复制编译实现。
- safe path、文件数/大小/总大小限制、日志限制、timeout、cancel、并发限制、temp cleanup。
- Tectonic 使用参数数组、`shell:false` 和 `--untrusted`。
- 编译结果绑定源码 SHA-256；结果返回时源码已变化，不把当前项目标记为 compiled。
- Topbar 在编译中显示 Cancel，实际 abort Electron job。
- 引擎解析顺序：`MEDPRISM_TECTONIC_PATH` → packaged resource → PATH。
- electron-builder 配置加入 `shared/**/*` 和可选 `resources/tectonic`。

### P04 — localStorage 稳定性

- `projectIndex + project.<id> + projectRecovery.<id>`。
- `schemaVersion`、numeric revision CAS、旧数据迁移、写后验证与恢复副本。
- 首次成功保存也生成 recovery；损坏 primary 后可恢复。
- 750 ms debounce 与串行保存队列；连续快照保留最新缓冲。
- queue-owned rebase 只在存储内容完全匹配时发生，不覆盖其他 tab/writer。
- 保存、删除使用尽力回滚；quota/parse/storage 错误对 UI 可见。
- ProjectsPage 的创建、重命名、删除和加载均检查 typed storage result。
- 4 MiB 应用级软提醒，不假设浏览器固定配额。
- 无依赖 ZIP 导出，所有 ZIP entry 复用 safe project path，阻止 zip-slip。

### P05 — Citation Workflow

- 固定流程：selection → Europe PMC → LLM candidate judgement → runtime metadata/BibTeX → atomic Patch。
- LLM 只能返回 candidate ID、relation、selected、reason。
- DOI/PMID/citeKey/BibTeX 来自 trusted tool result 与确定性代码。
- title-only candidate 不能标为 `supports`。
- 搜索重复记录按 DOI/PMID/normalized title 去重。
- 只写入 LaTeX 已声明的 `\addbibresource` / `\bibliography` 目标。
- 多个有效 bibliography target 无法唯一决定时 fail closed，不猜路径。
- `.bib` 与 `\cite{}` 位于同一 PatchSet；重复 identifier 和 cite-key collision 可控。
- citation judgement 额外收到目标 claim 的 local manuscript context。

### P06 — Compile-Fix Workflow

- 每次 Fix 先编译当前 immutable snapshot；不复用可能过期的旧日志。
- 保守提取第一个 root error，warning 不提升为 fatal。
- 仅发送诊断文件目标行附近源码。
- 只接受一个最小 `replace_text`，且默认只能修改 diagnostic path。
- oldText 必须在诊断 source window 中恰好匹配一次。
- 支持 LF、CRLF 和 CR 行结尾的精确字符 range。
- `patch.verify.compile === true` 是唯一重新编译触发依据。
- Keep 后只验证编译一次，不做无限 self-fix。

## 4. 本地独立验证结果

由于当前执行环境无法从 GitHub/npm 拉取完整仓库依赖，本次建立了不依赖仓库 `node_modules` 的严格验证工作区，实际通过：

- **33 项功能/回归测试**；
- strict TypeScript；
- `exactOptionalPropertyTypes`；
- `noUncheckedIndexedAccess`；
- 模拟完整应用 import/typecheck（包含实际 Workspace、Topbar、AssistantCard）；
- Electron/server/shared `.mjs/.cjs` 的 `node --check`；
- Python apply/verifier 脚本语法检查；
- overlay 应用脚本的临时 Git 仓库 smoke test；
- fake Tectonic 的成功、路径穿越、timeout 和 cancellation 测试。

本地功能测试最终输出：

```text
1..33
```

## 5. 为什么仍标记为黄色

以下验证必须在完整仓库或真实安装包中完成，当前不能诚实地替代：

1. `npm ci && npm test && npm run typecheck && npm run build && npm run lint`。
2. GitHub Actions `Plan01-06 verification` workflow。
3. Windows x64、Linux x64、macOS arm64 packaged Electron smoke。
4. 经过许可证审核的真实 Tectonic 二进制或系统 Tectonic。
5. 真实 Europe PMC 网络、限流与失败行为。
6. 多个真实 LaTeX 项目的 compile-error corpus。

## 6. 已知限制

- 项目文件模型仍是纯文本，不支持 PNG/PDF figure 二进制 round-trip。
- 本交付不重新分发 Tectonic 二进制；公开发布前必须补 reviewed binaries + license notices，或明确要求用户安装。
- Citation v1 只接 Europe PMC，没有第二来源核对、撤稿/更正状态和全文证据。
- `\addbibresource{../refs.bib}` 这类含父级相对路径的工程会 fail closed；V1 不自动解释文件系统相对路径。
- Compile log parser 有意保守；无法安全定位时不猜文件。
- Review workflow 和通用 Skill/Router 大重构属于 P07，不在本次范围。

## 7. 仓库验证命令

应用代码后运行：

```bash
python3 scripts/verify_plan01_06.py --install
```

发布 Gate 额外要求真实 Tectonic：

```bash
python3 scripts/verify_plan01_06.py --require-tectonic
```

未完成真实 packaged smoke 前，不应把 P03/P06 标为绿色。
