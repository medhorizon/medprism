---
name: nature-writing
description: >-
  MedPrism CNS/Nature 首稿 Skill（源自 yuan1z0825/nature-skills@nature-writing）。
  仅当用户明确主投 Nature / Science / Cell（CNS）或 Nature 子刊时启用。
  Triggers: Nature, Nature Communications, Science, Cell, CNS, 首稿, 旗舰刊.
source: yuan1z0825/nature-skills@nature-writing
---

# Nature writing（MedPrism 适配 · 按需）

## 启用条件

**仅当**用户明确主投 / 对标：

- Nature 旗舰或 Nature Portfolio 子刊
- Science / Cell 或口中的「CNS」

否则退回 `academic-paper`，不要套用 Nature 叙事模板。

## 做法

1. 先确认主张、关键结果、边界（缺则列出 Assumptions，不编造）。
2. 按 Nature 风格组织：宽受众摘要逻辑、贡献句前置、结果驱动叙事。
3. 写入当前 LaTeX 工程（suggestion），而非只输出 Markdown 长文。
4. 需要引用时配合 cite 路由；首稿材料（cover letter 等）仅在用户索要时另给文件 suggestion。

## 边界

- 润色成品段落 → `nature-polishing`
- 普通医学期刊稿 → `academic-paper` + `scientific-writing`
