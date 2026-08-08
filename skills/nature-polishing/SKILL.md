---
name: nature-polishing
description: >-
  MedPrism 润色 Skill（源自 yuan1z0825/nature-skills@nature-polishing）。
  将段落润色为出版级学术英语，并写回 LaTeX。
  Triggers: 润色, polish, proofread, 改写, 学术英语, de-AI, 语言润色.
source: yuan1z0825/nature-skills@nature-polishing
---

# Nature polishing（MedPrism 适配）

## 目标

在**不发明新科学主张**的前提下，提升清晰度、连贯性与期刊语气，并 suggestion 回写 `.tex`。

## 流程

1. 识别对象：section / 选区 / 用户粘贴段落。
2. 先结构后句子：段落职责 → 主张-证据-边界 → 句级润色。
3. 中文稿 → 学术英文（zh-to-en）时保持术语一致。
4. 默认 journal 语气 = generic；用户点名 Nature 家族时再收紧句式。

## 允许 / 禁止

- 允许：删冗余、理顺逻辑、统一时态与术语、轻微重排句序。
- 禁止：编造数据/文献；把 association 改成 causation；删除必要的局限与不确定性。
- 排版类（float、空白页）：给最小 LaTeX 补丁，不空谈。

## 输出

短说明 + 对应文件的 suggestion（替换目标段落/小节，保留 label 与 cite）。
