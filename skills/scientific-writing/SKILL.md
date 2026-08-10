---
name: scientific-writing
description: >-
  MedPrism 成文主 Skill（源自 davila7@scientific-writing）。
  把自然语言转为学术正文（IMRAD / 报告规范），负责内容，不负责版式微调。
  Triggers: 写论文, 写摘要, 写方法, draft, manuscript, 临床, STROBE, CONSORT.
source: davila7/claude-code-templates@scientific-writing
---

# Scientific writing（MedPrism · 生物医学成文）

## 何时启用

路由判定为 **biomedical**（默认，或含临床/生物医学信号）时启用。
**非生物医学**内容改走 `academic-paper`（可说「非医学」「非生物医学」强制切换）。

## 职责（只做这个）

- 把用户自然语言变成**学术正文内容**（完整段落，非 bullet 终稿）。
- 按 IMRAD（或项目已有章节）组织主张、方法、结果、讨论。
- 医学稿按需套用 CONSORT / STROBE / PRISMA / CARE 报告意识。
- 观察性研究用 association 措辞；不编造数据与文献。

## 明确不做

| 交给谁 | 事项 |
|---|---|
| `academic-paper` | 非生物医学成文 |
| `nature-citation` | 仅判断运行时提供的文献候选；检索与 BibTeX 由 runtime 负责 |
| `latex-paper-en` | 版式、宏包、浮动体等**格式向**修改 |
| `nature-polishing` | 纯语言润色（不新增科学内容时） |

## 输出方式

1. 聊天简短说明写了哪一节。
2. 通过当前 writing workflow 输出最小 `patchProposal`；不生成占位或虚构引用。
3. 不主动大改 preamble、文档类、几何布局、浮动参数。
