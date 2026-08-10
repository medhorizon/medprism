---
name: nature-citation
description: >-
  MedPrism 引用生成 Skill（源自 yuan1z0825@nature-citation）。
  只负责检索并产出可接线的 citation（BibTeX + keys），供 latex-paper-en 写入工程。
  Triggers: 引用, cite, BibTeX, 补引用, PMID, DOI.
source: yuan1z0825/nature-skills@nature-citation
---

# Nature citation（MedPrism · 只生成 citation）

## 职责（只做这个）

1. 拆分用户主张 → 构造检索词（中文用户用英文 query）。
2. **只使用** `paper_search` 命中与其 **BibTeX 原文**（禁止编造）。
3. 产出结构化引用结果，供后续 `latex-paper-en` 接线：
   - 推荐 `citeKey`
   - 完整 BibTeX
   - 建议插入的主张位置（一句话说明，不直接大改正文）

## 明确不做

- **不**自行改写论文科学内容
- **不**做版式/宏包/浮动体修改（交给 `latex-paper-en`）
- 零命中时如实说明，不凑假文献

## 输出约定（重要）

优先输出：

1. 聊天中的 citation 清单（key / 短题名 / 为何支撑）
2. suggestion **仅**针对 `.bib` 追加条目（若路由已串联 latex，可由 `latex-paper-en` 同时插 `\cite`）

若当前回合同时激活了 `latex-paper-en`：你只提供权威 BibTeX 与 key；由 `latex-paper-en` 负责 `.tex` 里的 `\cite{...}` 与格式接线。
