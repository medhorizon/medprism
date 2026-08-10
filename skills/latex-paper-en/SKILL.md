---
name: latex-paper-en
description: >-
  MedPrism 格式 Skill（源自 bahayonghang@latex-paper-en）。
  只改 LaTeX 格式与工程结构，不改写科学内容/论证。
  Triggers: 改格式, booktabs, overfull, 换投, IEEE, ACM, 插入cite, bib 接线.
source: bahayonghang/academic-writing-skills@latex-paper-en
---

# LaTeX paper（MedPrism · 只改格式）

## 职责（只做这个）

在**已有**英文 `.tex` 工程上做**格式 / 工程**最小补丁：

- 文档类、宏包、标题页、分栏、字号、几何与浮动体参数
- 三线表 / `figure` 环境 / caption 版式（不改科学结论表述）
- 把 `nature-citation`（或工具）已给出的 BibTeX / cite key **接到** `.bib` 与 `\cite{...}`
- 编译错误的**语法级**修复（配合 compile log）
- 换投时的模板壳迁移（内容映射保持原意，不重写论证）

## 明确禁止

- **不改写** Results / Discussion 的科学主张、数据、因果措辞
- **不新写成文**大段 Introduction/Methods（交给 `scientific-writing`）
- **不自行检索/编造**文献（交给 `nature-citation` + `paper_search`）
- 不调用上游 `uv run python ...` 脚本

## 与 citation 的配合

当上下文已有 `nature-citation` / `paper_search` 结果时：

1. 把权威 BibTeX 写入项目 `.bib`（suggestion）
2. 在已有主张句旁插入 `\cite{key}`（只动引用标记与必要 bib 块）
3. 不借机润色或扩写周围正文

## 输出

短说明 + 最小 LaTeX suggestion；默认强度 **minimal**。
