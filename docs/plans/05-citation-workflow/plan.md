# P05 — Citation Workflow

**Status:** ⬜ Not started  
**Priority:** P1  
**Depends on:** P01 Typed Patch、P02 Context  
**Blocks:** 可靠的“给这句话补引用”

---

## 1. 目标

把当前“paper search + 多份 Skill 一起塞进 prompt”的引用行为改造成一条真正有先后顺序、可验证的 workflow：

```text
claim/selection
  → search
  → CitationPlan
  → metadata verify
  → dedupe
  → .bib patch
  → \cite{} patch
  → Diff
  → Keep
  → Compile（可选/推荐）
```

---

## 2. 核心原则

- 搜索不到合适证据时允许返回“未找到”。
- 不编造 DOI / PMID。
- 只看标题时不能声称论文支持具体 claim。
- `.bib` 写入与 `\cite{}` 插入必须是程序可校验 Patch。
- 不再把 `nature-citation + latex-paper-en` 两段 prompt 并列注入当作 pipeline。

---

## 3. 中间结果

新增：

```ts
type CitationCandidate = {
  title: string;
  authors?: string[];
  year?: number;
  doi?: string;
  pmid?: string;
  abstract?: string;
  source: string;
};

type CitationPlan = {
  targetPath: string;
  claim: string;
  targetAnchor: string;
  candidates: Array<{
    candidate: CitationCandidate;
    relation: "supports" | "contradicts" | "related" | "topic_match_only";
    citeKey?: string;
  }>;
  warnings: string[];
};
```

---

## 4. 实施步骤

### Step 1 — 获取 claim

优先级：

1. selectedText
2. active file 中可明确定位的用户指向句
3. 无法确定则不要生成可应用引用 Patch

### Step 2 — 搜索

先复用现有 `paperSearch.ts`。

- [ ] query 与用户动作词分离。
- [ ] 保存 search source。
- [ ] 保存 DOI/PMID 等原始 metadata。
- [ ] 不从模型自由生成 identifier。

### Step 3 — Citation Skill 只做判断

Citation Skill 输入：

- claim
- candidate metadata
- abstract（如果有）

输出：

- relation
- 哪些候选值得引用
- 警告

不负责直接字符串拼 `.bib` 和修改 `.tex`。

### Step 4 — Metadata verify

在写入前：

- [ ] DOI/PMID 格式规范化。
- [ ] 能通过当前 connector 重新确认 identifier 与 title 对应。
- [ ] metadata 不一致则不写入。
- [ ] title-only candidate 标成 `topic_match_only`。

### Step 5 — BibTeX normalizer

修改 `src/tools/bibtex.ts`：

- [ ] cite-key 生成稳定。
- [ ] DOI 去重。
- [ ] PMID 去重。
- [ ] normalized title 去重。
- [ ] cite-key collision 生成新 key，不覆盖旧 entry。
- [ ] author/year 字段不从不可靠字符串随意猜。

### Step 6 — 生成两个 Patch

依赖 P01：

1. `bib_add`
2. `insert_before/after` 在目标 claim 附近插 `\cite{key}`

必须是同一个 PatchSet，避免只写 bib 不写 cite 或相反。

### Step 7 — Diff / Keep

Diff 中区分：

```text
references.bib: +1 entry
sections/introduction.tex: + \cite{...}
```

Keep 后如 CompileService 可用，设置：

```ts
verify.compile = true
```

---

## 5. 暂不做

- 一次接所有 scholarly database
- 全文 PDF 自动证据抽取
- Zotero 双向同步
- Citation graph
- 自动决定期刊 citation style 的大型系统

先把当前 Europe PMC 路径做正确，再抽象 connector。

---

## 6. 测试

- [ ] 有 DOI 的正确候选。
- [ ] 重复 DOI。
- [ ] cite-key 冲突。
- [ ] 只有 title 无 abstract。
- [ ] 搜索无结果。
- [ ] metadata 不一致。
- [ ] 同一 PatchSet 同时修改 `.bib` + `.tex`。
- [ ] 第二个 operation 失败时整个引用 patch 不应用。
- [ ] 不生成虚构 identifier。

---

## 7. Definition of Done

- [ ] Citation workflow 有明确代码步骤。
- [ ] 有结构化 `CitationPlan`。
- [ ] DOI/PMID 写入前验证。
- [ ] `.bib` 去重。
- [ ] `\cite{}` 精确插入目标 claim 附近。
- [ ] citation patch 原子应用。
- [ ] 不再依赖两份 Skill prompt 自行协调。
- [ ] title-only 不标记为 supports。

---

## 8. 实施记录

- PR:
- Commit:
- Connector:
- Citation eval:
- Master Plan 状态已更新: [ ]
