---
name: academic-paper
description: >-
  MedPrism 非生物医学成文入口（源自 imbad0202@academic-paper）。
  当内容非生物医学时替代 scientific-writing。
  Triggers: 非医学, 非生物医学, 计算机, 教育, 经济, 物理, 通用学术.
source: imbad0202/academic-research-skills@academic-paper
---

# Academic paper（MedPrism · 非生物医学成文）

## 何时启用

路由判定为 **general（非生物医学）** 时，本 Skill **代替** `scientific-writing` 负责成文。

也可在用户话里显式触发：`非医学` / `非生物医学` / `通用学术` / `用 academic-paper`。

## 职责（只做内容）

- 自然语言 → 通用学术正文（完整段落）。
- 按学科惯例组织（IMRaD / 理论文 / 综述等，随项目结构）。
- suggestion 写入 `.tex`；不编造文献与数据。

## 明确不做

| 交给谁 | 事项 |
|---|---|
| `nature-citation` | 检索与 BibTeX |
| `latex-paper-en` | 版式与 `\cite` 接线 |
| `scientific-writing` | 生物医学/临床成文 |

## 输出

短说明 + 正文 suggestion；不动 preamble/版式大改。
