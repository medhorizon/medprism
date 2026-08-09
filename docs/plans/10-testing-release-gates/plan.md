# P10 — 测试、E2E 与 Release Gate

**Status:** ⬜ Not started  
**Priority:** P1 / 持续任务  
**Depends on:** 各计划边做边补；最终 gate 依赖 P01–P09  
**Blocks:** V1 正式发布

---

## 1. 目标

让“修好了”不依赖人工感觉。

建立最小但有效的：

- unit tests
- integration tests
- packaged Electron smoke/E2E
- workflow eval
- release gate

---

## 2. package scripts

建议最终具备：

```json
{
  "scripts": {
    "test": "...",
    "test:unit": "...",
    "test:integration": "...",
    "test:e2e": "...",
    "typecheck": "...",
    "lint": "..."
  }
}
```

具体测试框架优先复用仓库已有依赖；没有时选简单、主流且与当前 Vite/React 兼容的工具。

---

## 3. Unit Test Matrix

### Patch

- replace
- insert
- ambiguity
- stale base
- atomic failure
- undo

### Context

- activeFile
- selection
- selectedText
- range validation

### Storage

- migration
- per-project save
- debounce
- recovery

### Citation

- dedupe
- cite-key collision
- identifier validation

### Compile parser

- common TeX root errors
- warnings

### Router

- 8 个核心真实用户请求

---

## 4. Integration Test Matrix

至少：

### Editing

```text
selection
→ mocked model PatchSet
→ validate
→ Diff
→ Keep
→ Undo
```

### Citation

```text
selection claim
→ mocked search
→ CitationPlan
→ bib + cite patch
→ Keep
```

### Compile-Fix

```text
compile error
→ diagnostic
→ mocked fix patch
→ Keep
→ compile success
```

### Storage

```text
legacy project
→ migrate
→ edit
→ debounce save
→ reload
→ export
```

### Auth

```text
email login
→ session
→ quota
→ revoke
```

---

## 5. Workflow Eval

准备小型固定 corpus，不追求“AI benchmark”包装。

检查：

- [ ] 不编造数据。
- [ ] 不编造 DOI/PMID。
- [ ] 观察性研究不自动升级为因果。
- [ ] “只改选区”不越界。
- [ ] citation 使用实际 search candidates。
- [ ] compile-fix 修改相关目标文件。
- [ ] review 默认不写回。
- [ ] review 披露 coverage。

---

## 6. Packaged E2E

至少一个平台先在 CI/人工正式执行，随后逐步扩展三平台。

完整路径：

1. 启动安装包。
2. 快捷登录或进入本地可用状态。
3. 创建/打开应用内 LaTeX 项目。
4. 编辑。
5. 选中一段。
6. 生成 Patch。
7. Diff。
8. Keep。
9. Undo。
10. Compile。
11. 制造 LaTeX error。
12. Fix with AI。
13. Keep。
14. Recompile。
15. Export。
16. 重启。
17. 项目仍可恢复。

全程：

- 无 Vite。
- 无独立 compile server。

---

## 7. Release Workflow

修改 `.github/workflows/release.yml`。

发布前至少：

```text
install
→ typecheck
→ lint
→ unit
→ integration
→ build
→ packaged smoke
→ package/release
```

如果某平台暂时无法自动 E2E，必须在 release checklist 中明确人工 gate，而不是默默跳过。

---

## 8. V1 Release Blocking Conditions

任何一项存在则不建议标记稳定版：

- [ ] `.tex` 仍有 EOF append。
- [ ] selection 越界。
- [ ] packaged compile 依赖 Vite。
- [ ] 保存失败静默。
- [ ] Export 还是假的。
- [ ] renderer 暴露长期 provider secret。
- [ ] citation 可自由生成未验证 DOI/PMID。
- [ ] Release workflow 在 test failure 后仍打包发布。

---

## 9. Definition of Done

- [ ] test runner 已接入。
- [ ] P01–P09 每项都有对应自动测试。
- [ ] packaged smoke test 有可重复脚本/checklist。
- [ ] release workflow 有 gate。
- [ ] 核心 workflow eval 可重复运行。
- [ ] 发布失败条件有明确阻断。

---

## 10. 实施记录

- PR:
- Commit:
- CI:
- E2E platforms:
- Master Plan 状态已更新: [ ]
