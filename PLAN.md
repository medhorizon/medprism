# MedPrism 实施计划

> 目标：从当前 UI 原型演进为可用的医学写作工作区（登录可选 · 项目列表 · 可插拔 API · Agent/Skill）。
> 风格约束：Graphite-on-paper + Source 下方 Assistant 卡片（对齐 Prism 布局）。

---

## 推荐执行顺序

```
Plan5 (UI 修复) → Plan1 (登录页) → Plan2 (项目列表)
       → Plan3 (API 连接策略) → Plan4 (AGENTS.md / prompts)
       → Plan01-Real（✅ 真实验证码 + NewAPI）→ Plan8A (Tool 壳 + PaperSearch)
       → Plan7A (Tectonic) → Plan8B (compile fix 环) → Plan6 Skill 接线
```

详见 [PLAN08.md](./PLAN08.md)。  
**Plan01 完成状态**见 [PLAN01.md](./PLAN01.md)；详规见 [PLAN01-REAL-AUTH.md](./PLAN01-REAL-AUTH.md)。

理由：先稳住壳层与路由，再接鉴权与数据，再接模型协议；**真编译依赖本地/服务端 TeX 环境与 Preview 接线，放在 Agent 流程之后作为独立里程碑。**

---

## Plan 1 · 登录页

### 目标
提供与工作区同语言的登录/进入页；**不强制登录**（与 Plan3 衔接）。

### 范围
- 路由：`/login`、`/`（工作区）、后续 `/projects`
- 登录页元素：品牌 **MedPrism**、邮箱/手机或 SSO 占位、主 CTA「登录」、次 CTA「先不登录，进入工作区」
- 视觉：白底、近黑字、细线、黑色主按钮；无彩色强调、无阴影堆叠
- 会话状态：`auth.status = guest | authenticated`，token 存 memory + `localStorage`（后续可换 httpOnly cookie）

### 交付物
- `src/pages/LoginPage.tsx`
- `src/state/auth.ts`（或 context）
- 路由骨架（`react-router`）

### 验收
- 未登录可进工作区（guest）
- 登录成功后跳转项目列表（Plan2）或上次项目
- 刷新后 guest/auth 状态可恢复

### 依赖 / 待你确认
- 真实后端鉴权方式（邮箱密码 / OAuth / 你方账号体系）
- 登录成功后默认落点：项目列表 vs 最近项目

---

## Plan 2 · 项目列表

### 目标
在进入编辑器前有「项目主页」：新建、打开、重命名、删除（软删）。

### 范围
- 路由：`/projects`
- 列表卡片/行：标题、更新时间、模板标签（如 IMRaD / Case Report）、所有者
- 操作：新建项目（模板选择）、打开 → `/p/:projectId`
- Guest：项目存 `localStorage` / IndexedDB
- Authenticated：项目走你的 API（与 Plan3 对齐）

### 数据模型（初版）
```ts
type Project = {
  id: string
  title: string
  updatedAt: string
  template?: string
  files: Record<string, string> // path -> content
}
```

### 交付物
- `src/pages/ProjectsPage.tsx`
- `src/state/projects.ts`
- 从单文件 `App.tsx` 拆出 `WorkspacePage`

### 验收
- 可建多个项目并互不影响
- 打开项目进入 Source | Preview | Assistant 卡片布局
- Guest 刷新不丢本地项目（至少 localStorage）

---

## Plan 3 · 可选登录 + API 连接策略

### 目标
两种用法并存：
1. **登录后**：自动使用你的托管 API（baseURL / key 由服务端或登录态签发，前端不硬编码密钥）
2. **自行配置**：用户填写 `baseURL` + `API Key` + `model`（OpenAI-compatible）

### 范围
- 设置面板（工作区或项目页）：`Connection`
  - Mode A：`Use MedPrism account`（需 authenticated）
  - Mode B：`Custom OpenAI-compatible`
- 存储：Mode B 的 key **仅存本机**（`localStorage` 加密可选；文档提示风险）
- `src/lib/llm.ts`：统一 `chatCompletions({ messages, tools? })`
- 失败态：401 / CORS / 超时的可读错误条

### 配置模型
```ts
type LlmConfig =
  | { mode: "hosted"; accessToken: string }
  | { mode: "custom"; baseUrl: string; apiKey: string; model: string }
```

### 验收
- Guest + Custom：可对话（替换当前 mock `replyFor`）
- Logged-in + Hosted：不要求用户填 key
- 切换 mode 后下一条消息走新配置

### 依赖 / 待你确认
- 托管 API 的真实 endpoint、鉴权头格式、是否支持 streaming
- CORS：是否需要本仓库加轻量 proxy（Vite/Fastify）

---

## Plan 4 · AGENTS.md / Prompt 体系

### 目标
把「医学写作助手」从散落 mock 抽成可版本管理的 prompt 资产。

### 建议目录
```
MedPrism/
  AGENTS.md                 # 总代理：角色、安全、输出协议
  prompts/
    system.med-writer.md    # 常驻 system
    context.project.md      # 如何注入文件树/光标/编译 log
    reply.formats.md        # patch / suggestion JSON schema
```

### AGENTS.md 必含条款
1. 角色：医学/科研 LaTeX 写作助手，默认就地改稿
2. 硬约束：不编造 PMID/DOI；不确定则检索或标注
3. 上下文：始终考虑当前 project files + 活动文件
4. 输出：聊天解释 + 可选 `suggestion { path, body }` 或 unified diff
5. 边界：不给临床诊疗决策；统计措辞用 association 非 causation（除非 RCT）

### 与运行时连接
- 前端组装：`system = AGENTS + 项目摘要`；`user = 对话 + 选区`
- 后续可由 Plan6 Skill 覆盖专项流程

### 验收
- 同一问题在「润色 / 修编译 / 加引用」三类任务上输出格式稳定
- 文档可被人和模型共同维护（Markdown，无二进制）

---

## Plan 5 · 修复 UI

### 目标
对齐 Prism 交互细节，修当前原型问题，再扩展页面不走样。

### 已知 / 优先修复清单
| 项 | 说明 |
|---|---|
| Assistant 悬浮卡片 | ✅ 浮在 Source 底部；顶部 grip 可拖高度（见 [PLAN05.md](./PLAN05.md)） |
| 左右侧栏拖拽 | ✅ Files / Preview 宽度可拖 |
| PDF 滚动预览 | ✅ 多页纵向堆叠，鼠标滚轮浏览全部 |
| Source / Preview 同步 | 编辑后 Preview 脏状态；Compile 后刷新 |
| 文件 Tab | 可选：编辑器顶栏多文件 tab（贴近截图） |
| Outline | 左侧 Files 下增加大纲（从 `\section` 解析） |
| 登录 / 项目页 | 复用同一 token，避免第二套视觉语言 |
| 响应式 | 窄屏堆叠；侧栏拖拽改为横向分隔 |
| 无障碍 | 拖拽 separator 键盘可调；焦点环可见 |
| 暗色对照 | 若要完全贴近截图暗色 IDE：作为可选 theme token，不阻塞主线 |

### 交付物
- 设计 token 收敛到 `src/styles/tokens.css`
- 组件拆分：`Topbar` / `FileTree` / `SourcePane` / `AssistantCard` / `PreviewPane`

### 验收
- 三页（Login / Projects / Workspace）视觉一致
- Assistant 拖拽高度限制在 180–520，不遮死 Source

---

## Plan 6 · Skill + Script

### 目标
按 OpenAI Skills 三层：Prompt 常驻、Skill 按需、Script 确定性。

### 建议 Skill 包（先做 4 个）
| Skill | 触发 | Script |
|---|---|---|
| `fix-compile-errors` | 编译失败 / Fix with AI | `parse_log.py` 或 TS 解析器 |
| `section-revise` | 润色 / 改因果措辞 | 无（纯指令） |
| `literature-cite` | 加引用 / Sepsis-3 | 预留检索 stub |
| `image-to-latex` | 图转公式（后期） | 无（多模态） |

### 目录
```
skills/
  fix-compile-errors/
    SKILL.md
    scripts/parse_compile_log.ts
  section-revise/
    SKILL.md
  literature-cite/
    SKILL.md
```

### 运行时策略（MVP）
1. 前端根据用户意图 / 快捷芯片选择 skill
2. 将 `SKILL.md` body 拼进 system 或 tool 说明
3. 需要时在浏览器或本地小服务跑 script，结果回灌模型

### 验收
- 「Diagnose compile warnings」走 `fix-compile-errors`，不再用关键词 if/else mock
- Skill 可在 Cursor/Codex 侧复用同一套 `SKILL.md`

---

## Plan 7 · 真实 LaTeX 编译（后续）

> **现状（2026-08-08）**：Compile 仅为 UI mock（约 0.9s 状态切换 + toast）；Preview 是 HTML 纸面样稿，**不会**执行 TeX，也**不会**按源码生成 PDF。

### 目标
点击 **Compile** 时，用真实 TeX 引擎把项目源码编成 PDF，并在右侧 Preview 中滚动查看；失败时把 compile log 交给 Assistant / `fix-compile-errors` Skill。

### 范围（建议分两阶段）

**7A · MVP（本地或轻量服务）**
- 引擎二选一（默认优先轻量）：**Tectonic** 或 **latexmk + TeX Live**
- 后端/本地桥：`POST /api/compile`（或 Vite 旁路小服务）
  - 入参：项目文件树（path → content）或项目目录快照
  - 出参：`pdf`（blob/url）+ `log` + `ok | error`
- 前端：`compile()` 调真实接口；成功用 PDF.js（或 `<iframe>` / object）渲染；失败展示 log +「Fix with AI」
- 脏状态：源码变更 → `Source changed`；编译成功 → `PDF up to date`

**7B · 增强**
- 增量编译 / 缓存（按文件 hash）
- 多引擎切换（pdflatex / xelatex / lualatex，中文稿优先 xelatex）
- 编译超时、包缺失提示、与 Plan6 `parse_compile_log` 闭环
- 云端编译（登录用户走托管队列；Guest 仅本地）

### 交付物
- `server/` 或 `apps/compile-service/`（Node/Rust 包装 TeX）
- `src/lib/compileClient.ts`
- Preview 真 PDF 渲染（替换当前静态 HTML pages）
- 环境说明：`docs/compile-setup.md`（安装 Tectonic/TeX Live）

### 验收
- 改 `abstract.tex` 后 Compile，Preview 可见对应文字变化
- 故意写坏 `\begin{itemize}` 未闭合 → 编译失败 + log 可见 + Fix with AI 可消费 log
- 多页 PDF 可用鼠标滚动预览全部页面

### 已拍板（暂未开工）
| 项 | 决定 |
|---|---|
| 启动状态 | **暂未开始** |
| 运行位置 | **本机** |
| 引擎 | **Tectonic**（不用 TeX Live 作为 MVP） |
| 中文/字体 | 待开工前再确认（若需 CJK 再评估 xelatex 路径） |

### 与其它 Plan 的关系
- Plan5：滚动 Preview 壳可复用；真 PDF 替换 HTML 纸面  
- Plan6：`fix-compile-errors` 依赖本 Plan 产出的真实 log  
- 当前 mock Compile 保留到 7A 接线完成后再删除

---

## 里程碑（建议）

| 里程碑 | 包含 | 完成定义 |
|---|---|---|
| M0 | 目录整理 + 路由壳 + UI 拆分 | ✅ 完成：pages/components/state/lib/styles/prompts/skills |
| M0.5 | 模板库 | ✅ 内置官方包文件夹 `templates/official/*`，一键复制建项 |
| M1 | Plan1 + Plan2 | ✅ 登录/访客、重命名、删除确认、中英 UI（默认中文） |
| M1.5 | **Plan01-Real** | ✅ 验证码（Resend）+ NewAPI 自动发 Key + refresh 快速登录；见 [PLAN01.md](./PLAN01.md) |
| M2 | Plan3 | ✅ Hosted（登录签发）/ Custom（访客）均可真实对话 |
| M3 | Plan4 + Plan6 MVP | AGENTS.md + 2 个 Skill 上线 |
| M4 | Plan5 抛光 + 其余 Skill | 接近 Prism 日常可用性 |
| M5 | **Plan7 真实编译** | Compile → 真 PDF + log；Preview 可滚动全文 |

---

## 风险与默认决策

| 风险 | 默认决策 |
|---|---|
| 尚无后端 | M1 用 local auth stub + local projects；API 接口预留 |
| API Key 安全 | Custom key 仅本机；Hosted 走你方 token |
| 编译 PDF | **当前继续伪 Preview**；真编译见 **Plan7 / M5**（已定：本机 Tectonic，暂未开工） |
| TeX 体积大 | MVP 用本机 Tectonic；缺宏包再评估补包或升 TeX Live |
| 你写「agent.md」 | 统一用仓库根 `AGENTS.md`（业界常见）；若你坚持 `agent.md` 可并存软链 |

---

## 下一步（需你拍板）

1. **Plan01**：✅ 已完成（见 [PLAN01.md](./PLAN01.md)）  
2. **Streaming / 代理不下发用户 key**：可选加固  
3. **Plan7 编译**：✅ 已选本机 Tectonic；**暂未开工**（排在 M5）
