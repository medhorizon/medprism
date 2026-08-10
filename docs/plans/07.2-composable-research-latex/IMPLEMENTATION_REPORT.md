# MedPrism Plan07.2：独立 Research + 可组合 Workflow + 统一 LaTeX 应用

> 目标分支：`cursor/auth-registration-quota-200`  
> 原始源码基线：`03dd0a4bc4e977f19e9b7c58c5ef845ec9868929`  
> 增量基线：此前完成的 Plan07.1 Debug 源码  
> 状态：代码实现与离线回归完成；仓库原生 npm / GitHub CI 验证待执行

## 1. 本次重构解决的问题

此前的“调研 HCC 并写摘要”修复虽然能解决具体场景，但架构仍然过度围绕 Abstract。真正需要的产品模型是：

```text
Research 是独立能力
  ├─ 可以只做调研
  ├─ 可以 Research + Writing
  ├─ 可以 Research + Polish
  ├─ 可以 Research + Citation
  └─ 可以 Research + Review

任何产生文本修改的流程
  → 统一进入 LaTeX target/application
  → Typed Patch
  → Validator
  → Diff / Keep / Undo
```

本次没有增加自由行动 Agent、Planner 或 DAG，而是实现了一个小型、线性的组合模型。

## 2. 最终运行架构

```text
用户请求 / UI Action
  ↓
Deterministic Router
  ↓
WorkflowPlan
  ├─ Research stage（可选，独立）
  ├─ Primary workflow（恰好一个）
  │    ├─ Research-only
  │    ├─ Writing
  │    ├─ Polish
  │    ├─ Citation
  │    ├─ LaTeX
  │    ├─ Compile-Fix
  │    └─ Review
  └─ latex-apply（会修改文本时）
  ↓
Patch Validator
  ↓
Diff / Keep / Undo
```

`WorkflowPlan` 是 TypeScript 生成的固定线性计划。模型不能创建、删除、重排或跳过阶段。

## 3. Research 已独立

新增：

```text
src/lib/research/
├── types.ts
├── service.ts
└── service.test.ts
```

Research 模块只负责：

1. 接收 Router/Runtime 已确定的查询主题；
2. 调用一次 `paper_search`；
3. 校验返回格式和候选 ID；
4. 检查是否存在 abstract-level evidence；
5. 生成可被后续流程复用的 `ResearchBundle`。

Research **不修改任何文件**，也不决定接下来写什么。

支持的组合包括：

```text
“调研 HCC”
→ ResearchReport
→ 无 Patch / 无 Keep

“调研 HCC 后撰写 Methods”
→ ResearchBundle
→ Writing
→ LaTeX Methods target
→ Patch / Keep

“调研 HCC 后润色 Discussion”
→ ResearchBundle
→ Polish
→ LaTeX Discussion target
→ Patch / Keep

“调研 HCC 并给这句话补引用”
→ ResearchBundle
→ Citation judgement
→ .bib + \cite{} 原子 Patch
→ Keep
```

Research connector 不再把完整指令（例如“调研 HCC 并写 Methods”）当作搜索词。必须由 Runtime 提供明确查询或精确选区。

## 4. LaTeX 不再只处理 Abstract

新增通用目标模型：

```text
src/lib/latex/types.ts
src/lib/latex/textTargets.ts
src/lib/latex/textTargets.test.ts
```

目前支持：

- 当前选区；
- Abstract；
- Title；
- Keywords；
- Introduction；
- Methods；
- Results；
- Discussion；
- Conclusion；
- Funding；
- Acknowledgements；
- Author Contributions；
- Data Availability；
- Ethics；
- Conflict of Interest；
- 整体正文；
- 自定义章节，例如 `Limitations`。

程序负责寻找现有 section/environment，或者根据文档结构确定安全插入位置。模型只返回目标正文，不返回：

- 文件路径；
- section/abstract wrapper；
- source range；
- hash/revision；
- 整个 `.tex` 文件。

## 5. 所有文本修改统一进入一个入口

新增：

```text
src/lib/workflows/latexApply.ts
```

它是文件修改的统一收口：

```text
Writing patch proposal       ┐
Polish text draft            │
Targeted section draft       ├→ latexApply → hydrate → validate
Citation bib/text patch      │
Compile-Fix patch            ┘
```

因此，Research 本身不会写文件；真正需要改稿时，后续 Primary workflow 才产生文本，随后统一进入 LaTeX/Patch 层。

Review 和 Research-only 被 Runtime 明确禁止返回 PatchSet。

## 6. 通用 Writing / Polish

新增：

```text
src/lib/workflows/textWriting.ts
src/lib/workflows/textSafety.ts
```

`textWriting.ts` 对所有 Runtime 可定位的文本目标共用同一流程：

```text
定位 LaTeX target
→ 一个写作/润色 Skill
→ 模型返回 textDraft
→ 校验可信 Research candidate IDs
→ 保留必要 LaTeX
→ Runtime 生成 Patch
```

Polish 会保护：

- 数字与单位；
- 数学公式；
- `\cite` / `\ref` / `\label`；
- LaTeX command 名称；
- environment 边界。

当原目标含有 LaTeX、公式或引用时，模型必须使用 `latex-body`，不能用普通文本悄悄删除结构。

## 7. Citation 的职责更清楚

Citation 不再自己重复搜索逻辑，而是消费独立 ResearchBundle：

```text
Research
→ Citation Skill 只判断 candidate
→ Runtime 生成 cite key
→ Runtime 生成 BibTeX
→ Runtime 生成 .bib + \cite{} Patch
```

模型不能生成 DOI、PMID、cite key 或原始 BibTeX。

Research + Polish + Citation 仍然是明确的短步骤，不是模型自由规划。

## 8. Prompt 分层

Prompt 现在由：

```text
Base Policy
+ 一个 Workflow Prompt
+ 可选 Capability Prompt
+ 一个主要 Skill
+ scoped context/tool data
```

Capability 与 Workflow 分离：

- `prompts/capabilities/research.md`：如何消费可信 ResearchBundle；
- `prompts/capabilities/latex-output.md`：说明 Runtime 拥有路径、范围和 Patch；
- `prompts/workflows/targeted-text.md`：适用于所有可定位文本目标，而非摘要专用。

旧的摘要专用 `research-writing.md` 已删除。

## 9. 兼容处理

为避免突然破坏旧调用：

- `abstractWriting.ts` 暂时保留，但已变成通用 `textWriting` 的薄适配器；
- 旧 `writingDraft` 仅作为兼容解析别名；
- 新模型输出统一使用 `textDraft`；
- 后续确认没有外部调用后，可删除兼容层。

## 10. 主要修改文件

新增或重点修改：

```text
src/lib/research/*
src/lib/latex/textTargets.ts
src/lib/workflows/executor.ts
src/lib/workflows/types.ts
src/lib/workflows/textWriting.ts
src/lib/workflows/textSafety.ts
src/lib/workflows/latexApply.ts
src/lib/workflows/writing.ts
src/lib/workflows/citation.ts
src/lib/workflows/research.ts
src/lib/workflows/review.ts
src/lib/skillRouter.ts
src/lib/replyParse.ts
prompts/capabilities/*
prompts/workflows/targeted-text.md
```

没有修改：

- 快捷登录产品行为；
- localStorage 产品决策；
- Electron CompileService 架构；
- `package-lock.json`；
- npm dependencies。

没有引入：

- LangChain；
- LangGraph；
- AutoGen；
- 通用 Planner；
- DAG Engine；
- 多 Agent 系统。

## 11. 验证结果

已完成：

```text
严格 Source TypeScript 检查               PASS
严格相关 Test TypeScript 检查             PASS
离线全仓库回归测试                        106 / 106 PASS
组合 Runtime Smoke                       PASS
增量 Git Patch apply + tree compare       PASS
累计 Git Patch apply + tree compare       PASS
git diff --check                          PASS
package-lock.json unchanged               PASS
```

测试覆盖：

- Research-only；
- Research + Abstract / Methods / Discussion / Funding；
- Research + 自定义 `Limitations` section；
- Research + Polish selection；
- Research + Polish named section routing；
- Research + Citation；
- trusted candidate ID 校验；
- title-only evidence 拒绝；
- 通用 LaTeX target 定位与创建；
- Polish 保留数字、引用和 LaTeX；
- invalid structured result 不产生 Keep；
- P01–P06 既有回归。

## 12. 官方 npm 验证限制

在当前隔离执行环境中尝试：

```bash
npm ci --ignore-scripts
```

该命令在 120 秒内未完成，被主动终止；生成的部分 `node_modules` 已删除。`package-lock.json` 使用腾讯镜像下载地址，因此仍需在正常开发机或 GitHub Actions 中运行：

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run lint
```

在上述命令完成前，仓库状态应保持：

```text
🟨 Implemented — CI verification pending
```

## 13. 已知限制

- Research 目前每个阶段使用一个确定性查询，不是多查询研究 Agent；
- 文献源仍是现有 connector；
- UI 尚未用图形展示 `Research → Writing → LaTeX` 阶段；
- Review finding 的逐条 Apply UI 仍待后续实现；
- Abstract 兼容适配器尚未完全删除。

## 14. 应用方式

交付包提供两个 Patch：

- `cumulative`：从原始 `03dd0a4` 分支源码直接升级到 Plan07.2；
- `incremental`：已经应用 Plan07.1 Debug 时，只追加 Plan07.2。

推荐运行交付包中的自动脚本：

```bash
python3 apply_plan07_2.py /path/to/MedPrism --check
python3 apply_plan07_2.py /path/to/MedPrism
```

脚本会自动判断哪个 Patch 与当前仓库匹配，不会同时应用两份。
