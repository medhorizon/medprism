# Skills（Plan6）

产品语义：**自然语言 → 学术成文 →（可选）生成 citation → LaTeX 格式接线**。

## 已确认分工

| Skill | 职责 |
|---|---|
| **`scientific-writing`** | **生物医学成文** |
| **`academic-paper`** | **非生物医学成文**（替代上一行） |
| **`nature-citation`** | **只生成 citation**（BibTeX/keys，经 `paper_search`） |
| **`latex-paper-en`** | **只改格式**；并把 citation **接入** `.bib` / `\cite` |

成文 domain：`detectWritingDomain`（看用户话 + 主 tex 摘要）。  
强制入口：说「非医学 / 非生物医学 / 通用学术」→ `academic-paper`。

引用链路：`cite` = `nature-citation` → `latex-paper-en`。

## 路由（`src/lib/skillRouter.ts`）

| 意图 | Skills | 工具 |
|---|---|---|
| **write** | biomedical → `scientific-writing`；general → `academic-paper` | — |
| **cite** | `nature-citation` + `latex-paper-en` | `paper_search` |
| **latex** | `latex-paper-en` | — |
| **polish** | `nature-polishing` | — |
| **nature-writing** | `nature-writing` +（按 domain 的成文 Skill） | 仅明确 CNS/Nature |
| **fix-compile** | `fix-compile-errors` + `latex-paper-en` | `compile` / `parse_compile_log` |

全局契约：[`_medprism-contract.md`](./_medprism-contract.md)。

## 两层存放

| 层 | 路径 |
|---|---|
| 上游原版 | `.agents/skills/*`（`npx skills add`） |
| MedPrism 适配 | `skills/*`（Assistant 运行时） |

`section-revise` 已弃用 → `nature-polishing`。
