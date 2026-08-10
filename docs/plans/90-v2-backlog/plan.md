# B01 — V2 / 延后架构事项

**Status:** ⬜ Deferred  
**Priority:** Backlog  
**Depends on:** V1 核心链稳定  
**原则:** 只有出现真实需求或 V1 明显遇到瓶颈时才启动。

---

## 1. 目的

集中存放已经识别、但**不应该阻塞 V1** 的架构升级，避免它们重新混进 P01–P10。

---

## 2. 触发条件与后续方案

### A. IndexedDB / Binary Assets

触发：

- 大量 PNG/JPG/PDF figure；
- localStorage 文本模型无法覆盖项目资产。

方案：

```text
localStorage → metadata/settings
IndexedDB → binary assets / larger project data
```

---

### B. Electron Filesystem Project

触发：

- 需要打开用户已有 LaTeX folder；
- Git；
- VS Code/TeXstudio 协同；
- 项目规模明显增长。

方案：

```text
Electron Main ProjectService
→ open/read/write/watch/export
```

---

### C. SQLite

触发：

- 大量 chat/task/history/provenance；
- localStorage metadata 不再适合查询。

不要仅为了“桌面应用应该用数据库”而迁移。

---

### D. LaTeX 全文结构索引

触发：

- 真正需要大型多文件全文 review；
- cross-reference/citation consistency；
- 大量 `\input/\include`。

索引：

- sections
- include graph
- labels/refs
- citations
- equations
- figures/tables
- commands

---

### E. Skill Manifest

触发：

- Skill 数量明显增长；
- 第三方 Skill 频繁更新；
- 需要权限、版本、license、eval 管理。

再引入：

```yaml
id
version
commit
hash
permissions
inputs
outputs
evals
```

V1 继续 Markdown Skill 即可。

---

### F. Planner / DAG

触发：

- 大量真实需求需要任意组合 workflow；
- hard-coded workflow 维护成本明显高于收益。

在此之前继续：

```text
Router → deterministic workflow
```

---

### G. Local Model

触发：

- 明确离线要求；
- 数据不能外发；
- 本地硬件与模型质量足够。

模型位置变化不得绕过 Patch/Citation/Compile 验证协议。

---

## 3. 永久原则

即使进入 V2，也保留：

- Typed Patch
- Diff-before-Keep
- active scope
- citation verification
- compile verification
- user-controlled data egress
- quick login 产品决策（除非产品方主动修改）

---

## 4. Definition of Done

本文件不是一个需要一次“完成”的 PR。

每当触发一个 V2 能力：

1. 新建独立 `plan.md`。
2. 在 MASTER_PLAN 中加入新 ID。
3. 明确为什么现在需要它。
4. 不在本 backlog 里直接展开实现。
