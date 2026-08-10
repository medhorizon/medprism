# P04 — localStorage 稳定性与真实导出

**Status:** 🟨 Implemented; repository verification pending
**Priority:** P1  
**Depends on:** 无  
**Blocks:** V1 长期可靠自用/小范围分发

---

## 1. 目标

**保留 V1 的 JSON + localStorage 文本项目模型**，不做架构性大迁移。

只解决实际问题：

- 每个字符都重写所有项目；
- 一个大 key 保存所有项目；
- 保存失败可能不明显；
- 缺少 schema migration；
- 缺少恢复副本；
- Export 不是实际导出。

---

## 2. 本计划范围

适合继续存 localStorage：

- `.tex`
- `.bib`
- `.sty`
- `.cls`
- 其他小型文本配置

不在本计划中解决：

- PNG/JPG/PDF figure
- Git
- 外部编辑器同步
- 大型真实文件夹
- SQLite
- IndexedDB migration

---

## 3. 目标 key 结构

从：

```text
medprism.projects = [all projects + all files]
```

迁移为：

```text
medprism.projectIndex
medprism.project.<projectId>
medprism.projectRecovery.<projectId>
medprism.settings
```

Project 加：

```ts
schemaVersion: 1
```

---

## 4. 实施步骤

### Step 1 — Storage adapter

不要让 UI 到处直接 `localStorage.*`。

在 `src/state/projects.ts` 内先形成统一函数：

```ts
loadProjectIndex()
loadProject(id)
saveProject(project)
deleteProject(id)
migrateLegacyProjects()
```

### Step 2 — Legacy migration

首次读取时：

- [ ] 检查旧 `medprism.projects`。
- [ ] 逐项目写入新 key。
- [ ] 写入 index。
- [ ] 验证成功后再删除或标记旧数据。
- [ ] migration 可重复执行且不产生重复项目。
- [ ] 失败不得破坏旧 key。

### Step 3 — Debounce

编辑器输入：

- [ ] UI state 立即更新。
- [ ] localStorage 写入 debounce 500–1000ms。
- [ ] 切换项目/关闭窗口前触发 flush。
- [ ] 明确区分 dirty / saved 状态。

### Step 4 — 保存失败

捕获：

- quota exceeded
- JSON serialize error
- storage unavailable

UI 至少显示：

```text
保存失败。当前修改仍在内存中，请立即导出备份。
```

不能用“已保存”假状态覆盖失败。

### Step 5 — Recovery snapshot

每个项目保留：

```text
medprism.projectRecovery.<id>
```

推荐策略：

1. 当前有效版本 = primary。
2. 写入新版本前/后保留最近一个可解析版本。
3. 启动时 primary 解析失败可提示恢复。
4. 不要无限累积历史。

### Step 6 — 项目大小指标

计算序列化后的近似字节：

- [ ] 项目设置页/状态处可读取大小。
- [ ] 达到软阈值给出提示。
- [ ] 不硬编码声称“浏览器一定有 X MB”，只做应用自己的保守阈值。

### Step 7 — 真正 Export

至少支持：

- [ ] Export `.tex`（单文件项目）。
- [ ] Export ZIP（多文件文本项目）。
- [ ] ZIP 保持项目相对路径。
- [ ] `.bib/.sty/.cls` 一起导出。
- [ ] 导出失败必须真实显示失败，而不是 success toast。

如果 Electron 下载/文件保存能力暂未建设，可先使用浏览器 Blob download；后续 P09 可再统一桌面保存体验。

---

## 5. 二进制资产策略

V1 明确提示：

> 当前项目存储以文本 LaTeX 工程为主。

如果未来支持 figure：

```text
V1.5: IndexedDB 或 Electron filesystem 存 binary assets
```

不要把 base64 figure 全部塞进当前大 JSON。

---

## 6. 测试

- [ ] legacy migration。
- [ ] migration 重跑。
- [ ] 一个项目保存不重写其他项目。
- [ ] 500 次连续输入只触发合理次数持久化。
- [ ] flush。
- [ ] quota failure UI。
- [ ] corrupted primary → recovery。
- [ ] Export 单文件。
- [ ] Export ZIP 多层路径。
- [ ] 删除项目同步 index。

---

## 7. Definition of Done

- [ ] 不再每个字符同步写整库。
- [ ] project per-key 存储。
- [ ] 有 schemaVersion。
- [ ] 旧数据自动迁移且不破坏。
- [ ] 保存失败用户可见。
- [ ] 有最近恢复副本。
- [ ] 有真实 Export。
- [ ] 一个项目更新不重新 serialize 其他项目全文。

---

## 8. 实施记录

- PR:
- Commit:
- Migration version:
- 已知限制:
- Master Plan 状态已更新: [ ]
