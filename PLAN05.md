# Plan05 · UI 修复日志

> 约定：Plan05 相关每次改动必须在本文件追加一条 **修改 log**（时间 + 变更要点 + 涉及文件）。

---

## 修改 log

### 2026-08-08 · M1 收尾：重命名 / 删除确认 / 登录访客 / 中英 UI

**诉求**
1. 项目重命名  
2. 删除二次确认  
3. 可 Sign in，也可 Continue as guest  
4. 默认中文 UI，可选英文  

**改动**
- `renameProject` + 重命名弹窗；删除确认弹窗
- 登录页可填邮箱本地登录 / 访客继续；状态展示与退出
- `src/i18n` LocaleProvider（默认 `zh`），壳层与工作区文案中英切换

**涉及文件**
- `src/i18n/**`、`LoginPage`、`ProjectsPage`、`WorkspacePage`、Topbar 等
- `src/state/auth.ts`、`projects.ts`、`PLAN.md`、`PLAN05.md`

---

### 2026-08-08 · 按建议清理官方包与 zip 代码

**诉求**
- 按目录检查建议删除冗余

**改动**
- ACM：删 tmp、根/`samples` 重复 sample；bib 提到包根
- Elsevier：删 `doc/`、changelog
- IEEE：删空 `extras/`
- 移除 `extractZip.ts` 与 `jszip` 依赖

**涉及文件**
- `templates/official/**`、`src/templates/*`、`src/state/projects.ts`
- `package.json`、`scripts/prepare-official-templates.mjs`、`PLAN05.md`

---

### 2026-08-08 · 官方包内置为文件夹（无需用户下载）

**诉求**
- 不要让用户自行下载 zip；把官方包内置成文件夹

**改动**
- 官方包 vendored 至 `templates/official/<id>/`（SN / Elsevier / IEEE / ACM）
- `import.meta.glob` 加载内置目录；Projects 一键创建
- `scripts/prepare-official-templates.mjs` 生成 cls/samples

**涉及文件**
- `templates/official/**`、`src/templates/loadBundled.ts`、`ProjectsPage.tsx`
- `scripts/*`、`templates/README.md`、`PLAN.md`、`PLAN05.md`

---

### 2026-08-08 · 模板库重构：仅官方 zip

**诉求**
- 模板库只用官方 zip，不再使用手写轻量起步稿

**改动**
- 删除 `src/templates/packs/*` 与自动附带 snippets
- 新增官方 catalog + JSZip 解压；Projects 改为「选条目 → 下载页 → 导入 zip → 建项目」
- Demo 样例保留，标注非官方模板

**涉及文件**
- `src/templates/*`、`src/pages/ProjectsPage.tsx`、`src/state/projects.ts`
- `src/styles/shell.css`、`templates/README.md`、`PLAN.md`、`PLAN05.md`

---

### 2026-08-08 · Plan7 拍板：本机 Tectonic（暂未开工）

**诉求**
- 真编译方案选型：本机 Tectonic；现阶段不开始实现

**改动**
- `PLAN.md` Plan7「已拍板」：本机 + Tectonic + 暂未开始
- M5 仍排队，当前 Compile 保持 mock

**涉及文件**
- `PLAN.md`
- `PLAN05.md`

---

### 2026-08-08 · 真编译列入后续计划

**诉求**
- 确认当前 Compile 无真实功能后，写入后续计划

**改动**
- 在 `PLAN.md` 新增 **Plan7 · 真实 LaTeX 编译**（7A MVP / 7B 增强）与里程碑 **M5**
- 明确现状：Compile 为 UI mock；真 PDF 待 Tectonic/TeX 服务接线

**涉及文件**
- `PLAN.md`
- `PLAN05.md`

---

### 2026-08-08 · Keep 防重复 + Undo 回滚

**诉求**
1. Keep 之后按钮应失效，避免重复追加建议内容
2. Undo 此前无功能，需能撤销已 Keep 的修改

**改动**
- 为 suggestion 增加状态：`pending | applied | undone | dismissed`
- Keep：写入源码并保存 `previousContent`；按钮变为 disabled「Kept」
- Undo：若已 applied → 恢复快照；若尚未 Keep → 关闭该建议卡片
- 抽出 `src/lib/suggestions.ts` 统一 apply / status 更新

**涉及文件**
- `src/types/chat.ts`
- `src/lib/suggestions.ts`（新建）
- `src/pages/WorkspacePage.tsx`
- `src/components/AssistantCard.tsx`
- `src/styles/workspace.css`
- `PLAN05.md`

---

### 2026-08-08 · 滚动预览全文 + Assistant 高度拖拽

**诉求**
1. PDF 预览可用鼠标滚动查看全部页面（不再只停在第 1 页）
2. Assistant 悬浮卡片顶部手柄可上下拖动调节高度
3. 建立本日志文件，此后 Plan05 改动均需记录

**改动**
- Preview：多页纵向堆叠于可滚动容器；去掉「一页一切换」分页器；工具栏显示总页数
- Assistant：恢复顶部 grip；向上拖变高、向下拖变矮（180–560px）
- 新增本文件 `PLAN05.md` 作为 Plan05 变更日志

**涉及文件**
- `src/components/PreviewPane.tsx`
- `src/components/AssistantCard.tsx`
- `src/pages/WorkspacePage.tsx`
- `src/styles/workspace.css`
- `PLAN05.md`（新建）
- `PLAN.md`（同步 Plan05 状态表）

---

### 2026-08-08 · Plan05 首轮（悬浮卡 / 侧栏拖拽 / 分页预览）

**诉求**
1. Assistant 改为悬浮卡片  
2. 左右侧栏可拖动调宽  
3. 编译 PDF 按页预览（当时做成单页 + `1/N` 翻页）

**改动**
- Assistant 从 Source 下方流式布局改为绝对定位悬浮于 Source 底部
- 新增 `ResizeHandle`，Files / Preview 宽度可拖（160–360 / 280–720）
- Preview 改为单页纸面 + 翻页控件（后续由上一条 log 改为滚动全文）

**涉及文件**
- `src/components/ResizeHandle.tsx`（新建）
- `src/components/AssistantCard.tsx`
- `src/components/PreviewPane.tsx`
- `src/pages/WorkspacePage.tsx`
- `src/styles/workspace.css`
- `PLAN.md`（勾选 Plan05 部分条目）

---

## 当前 Plan05 状态

| 项 | 状态 |
|---|---|
| Assistant 悬浮卡片 | ✅ |
| Assistant 上下拖高度 | ✅ |
| 左右侧栏拖宽 | ✅ |
| PDF 鼠标滚动预览全部页 | ✅（HTML 样稿滚动；**真 TeX 编译见 PLAN.md → Plan7**） |
| 每次修改写入本 log | ✅ 约定生效 |
| Compile 真功能 | ⛔ 非 Plan05；已记入后续 **Plan7 / M5** |
