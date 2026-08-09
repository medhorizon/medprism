# MedPrism 输出契约（始终生效）

## 分工（已确认）

| Skill | 只做什么 | 不做什么 |
|---|---|---|
| `scientific-writing` | **生物医学成文** | 非生物医学成文、版式、编文献 |
| `academic-paper` | **非生物医学成文**（替代 scientific-writing） | 生物医学专项报告规范、版式、编文献 |
| `nature-citation` | **生成 citation**：检索 → BibTeX / keys | 不改科学论述、不动版式 |
| `latex-paper-en` | **改格式 / 接线**：宏包、浮动体、把 citation 写入 `.bib`+`\cite` | **不改写**科学内容与论证 |
| `academic-paper-reviewer` | **审稿报告** + Revision Roadmap | 默认不大段重写成文/版式 |
| `nature-polishing` | 语言润色（可选） | 不新增主张、不编文献 |
| `nature-writing` | 仅明确 CNS/Nature 首稿时的内容向草稿 | 日常成文按 domain 选 scientific / academic |

成文入口：`detectWritingDomain` → biomedical 用 `scientific-writing`，general 用 `academic-paper`。  
强制：`非医学` / `非生物医学` → academic-paper；`生物医学` / `临床论文` → scientific-writing。

引用流水线：`nature-citation`（+ `paper_search`）→ `latex-paper-en` 接线。

## 通用规则

1. 用户自然语言描述意图（中/英均可）。
2. 编辑以 suggestion fence 写回项目文件（`path` 必填）。
3. 最小必要改动；保留 `\label`、既有 `\cite`、公式。
4. 不编造 PMID/DOI；医学观察性表述用 association。
5. 与 `AGENTS.md` 冲突时以 `AGENTS.md` + 本契约为准。
