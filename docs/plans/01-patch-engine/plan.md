# P01 — Typed Patch / `.tex` 原位替换

**Status:** ✅ Implemented (local)  
**Priority:** P0  
**Depends on:** 无  
**Blocks:** P05 Citation、P06 Compile-Fix、稳定的 writing/polish workflow

---

## 1. 目标

彻底移除当前“AI suggestion body 直接追加到 `.tex` 文件末尾”的行为。

完成后，AI 对已有 LaTeX 内容的修改只能通过**可定位、可验证、可预览、可撤销**的 Patch 应用。

---

## 2. 当前问题

重点检查：

- `src/lib/suggestions.ts`
- `src/lib/replyParse.ts`
- `prompts/reply.formats.md`
- `src/components/AssistantCard.tsx`
- 任何直接调用 suggestion apply 的位置

当前非 `.bib` suggestion 会走类似：

```text
previous content
+ suggestion body
```

因此“润色一段”“修一个错误”实际变成追加新正文，甚至可能落到 `\end{document}` 之后。

---

## 3. 本计划范围

### 必须做

- `replace_text`
- `insert_before`
- `insert_after`
- `bib_add`
- 精确 path
- base hash/revision
- 唯一匹配校验
- Diff
- Keep
- Undo
- malformed/stale patch fail closed

### 暂不做

- 通用 AST patch
- 模型输出整份文件后覆盖
- CRDT
- Git-based undo
- filesystem transaction engine
- 任意 fuzzy auto-apply

---

## 4. 建议数据结构

新增：

`src/lib/patch/schema.ts`

```ts
export type ReplaceTextOperation = {
  op: "replace_text";
  path: string;
  baseSha256: string;
  oldText: string;
  newText: string;
  expectedOccurrences: 1;
};

export type InsertOperation = {
  op: "insert_before" | "insert_after";
  path: string;
  baseSha256: string;
  anchor: string;
  text: string;
  expectedOccurrences: 1;
};

export type BibAddOperation = {
  op: "bib_add";
  path: string;
  entries: StructuredBibEntry[];
};

export type EditOperation =
  | ReplaceTextOperation
  | InsertOperation
  | BibAddOperation;

export type PatchSet = {
  schemaVersion: "1";
  id: string;
  summary: string;
  operations: EditOperation[];
  verify?: {
    compile?: boolean;
  };
};
```

如果当前工程不方便立即引入 SHA256，可第一小步用明确 `baseContent` revision/id，但最终必须能检测“模型生成建议后，文件已经被用户改过”的 stale patch。

---

## 5. 实施步骤

### Step 1 — 建立 Patch schema

- [x] 新建 `src/lib/patch/schema.ts`。
- [x] 明确所有必填字段。
- [x] 禁止任意未知 `op`。
- [x] 添加 runtime validator。
- [x] 所有 invalid patch 返回结构化错误，不展示 Keep。

### Step 2 — 建立纯函数 validator

新建：

`src/lib/patch/validate.ts`

至少检查：

- [x] target path 存在。
- [x] target path 与 patch 中 path 完全一致，不做 basename 猜测。
- [x] `baseSha256` 与当前文件一致。
- [x] `oldText` 出现次数等于 1。
- [x] `anchor` 出现次数等于 1。
- [x] `replace_text` 不允许空 `oldText`。
- [x] 单个 patch 不允许互相冲突的 operations。

错误码建议：

```ts
type PatchValidationErrorCode =
  | "FILE_NOT_FOUND"
  | "BASE_MISMATCH"
  | "OLD_TEXT_NOT_FOUND"
  | "OLD_TEXT_NOT_UNIQUE"
  | "ANCHOR_NOT_FOUND"
  | "ANCHOR_NOT_UNIQUE"
  | "INVALID_OPERATION"
  | "CONFLICTING_OPERATIONS";
```

### Step 3 — 建立纯函数 apply

新建：

`src/lib/patch/apply.ts`

要求：

- [x] 不直接 mutate 原对象。
- [x] 先在内存副本上应用所有 operation。
- [x] 任意 operation 失败，则整个 PatchSet 不应用。
- [x] 成功才一次性返回新的 `files`。
- [x] `.tex` 不允许 fallback 为 EOF append。

### Step 4 — `.bib` 特殊处理

- [x] `bib_add` 可继续在 `.bib` 合理位置追加。
- [x] 写入前做 cite-key 去重。
- [x] 有 DOI 时优先按 DOI 去重。
- [x] 重复项不覆盖已有项。
- [x] 不能把普通 `.tex` operation 降级为 `.bib` 风格 append。

### Step 5 — 替换旧 suggestion 解析

修改：

- `src/lib/replyParse.ts`
- `prompts/reply.formats.md`
- `src/lib/assistantRuntime.ts`

要求：

- [x] 新模型输出统一映射为 `PatchSet`。
- [x] 旧 `{path,title,body}` suggestion 不再具有直接 Keep 权限。
- [x] 若为了兼容必须暂时读取旧格式，只能展示文本，不能自动落盘。

### Step 6 — Diff UI

修改：

`src/components/AssistantCard.tsx`

最低版本：

- [x] 显示目标文件。
- [x] 显示 before。
- [x] 显示 after。
- [x] 显示 operation 类型。
- [x] Keep 前能看到具体变化。
- [x] invalid/stale patch 显示“需要重新生成”，不显示可用 Keep。

不要求第一版实现复杂 Git diff viewer，先用清晰的 before/after block 即可。

### Step 7 — Undo

- [x] Keep 前保存受影响文件的 revision snapshot。
- [x] Undo 只恢复该次 PatchSet 影响的文件。
- [x] 如果 Keep 后用户又手动编辑，Undo 必须检测冲突，不静默覆盖后续编辑。
- [ ] 聊天刷新后至少保留当前会话所需的最近一次恢复数据；可与 P04 的 recovery 进一步整合。

---

## 6. Prompt 修改要求

模型必须知道：

```text
你不能要求运行时把正文追加到文件末尾。
修改现有文本时必须输出 replace_text。
插入内容时必须给出唯一 anchor。
无法定位时，不输出可应用 Patch。
```

对于 selection task，`oldText` 优先使用实际 `selectedText`。

---

## 7. 测试

建议新增：

```text
fixtures/patches/
src/lib/patch/*.test.ts
```

至少覆盖：

- [x] 替换普通段落。
- [x] 替换 `\section{}` 中的内容。
- [x] 目标文本在 `\end{document}` 前，结果仍在原位置。
- [x] `oldText` 不存在。
- [x] `oldText` 出现两次。
- [x] anchor 不存在。
- [x] anchor 出现两次。
- [x] base hash stale。
- [x] 多 operation 第二个失败 → 第一个也不能落地。
- [x] `.bib` duplicate cite-key。
- [x] Undo 恢复。
- [x] Keep 后文件发生手动编辑 → stale undo 不静默覆盖。

---

## 8. Definition of Done

- [x] 生产代码中不存在对 `.tex` suggestion 的 EOF append。
- [x] 所有 AI `.tex` 修改都走 PatchSet validator。
- [x] 所有现有文本修改必须是 `replace_text` 或 anchor insert。
- [x] ambiguous/stale patch 100% 拒绝。
- [x] Keep 前能看到明确 diff。
- [x] Undo 可恢复。
- [x] Patch 单元测试通过。
- [x] `npm run build` 通过。

---

## 9. 实施记录

完成后填写：

- PR: （未开）
- Commit: （未提交；本会话仅改代码）
- 新增测试:
  - `src/lib/patch/apply.test.ts`（12）
  - `src/lib/replyParse.test.ts`（2）
  - 测试运行器：`vitest` + `vitest.config.ts`；`npm test` / `npm run typecheck`
- 已知限制:
  - 聊天刷新 / 跨会话 persistence 的 Undo snapshot 尚未与 P04 recovery 整合（内存会话内可用）。
  - before/after 为片段预览，非完整行级 Git diff。
  - 模型若漏填/错填 `baseSha256`，Keep 会失败（需重新生成）；workspace context 已注入 file hashes。
  - 旧 ` ```suggestion` 格式仅展示，不可 Keep（与计划一致）。
- Master Plan 状态已更新: [ ]

### 与计划差异（以当前代码为准）

- 未新增 `fixtures/patches/` 目录；用例直接写在 `*.test.ts`。
- `resolveSuggestionTarget` 的 basename 猜测已不再用于 Keep；Patch path 必须精确匹配。
- SHA-256 使用 Web Crypto（`crypto.subtle`），非 Node `crypto` 模块。

### 本任务实际修改文件

| 文件 | 变更 |
|------|------|
| `src/lib/patch/schema.ts` | 新增 PatchSet / ops / parsePatchSet |
| `src/lib/patch/hash.ts` | 新增 sha256Hex |
| `src/lib/patch/validate.ts` | 新增校验 + bib merge |
| `src/lib/patch/apply.ts` | 新增 apply / preview / undo |
| `src/lib/patch/apply.test.ts` | 新增单元测试 |
| `src/lib/replyParse.ts` | 解析 ` ```patch` / JSON `patchSet`；legacy 仅展示 |
| `src/lib/replyParse.test.ts` | 解析测试 |
| `src/lib/suggestions.ts` | 移除 `.tex` EOF append；Keep 走 PatchSet |
| `src/lib/assistantRuntime.ts` | context 注入 file hash；enrich PatchSet |
| `src/types/chat.ts` | suggestion 扩展 patch 字段 |
| `src/components/AssistantCard.tsx` | before/after diff；invalid 禁 Keep |
| `src/pages/WorkspacePage.tsx` | Keep/Undo 原子应用与冲突检测 |
| `src/styles/workspace.css` | diff / error 样式 |
| `src/i18n/*` | patch/undo 文案 |
| `prompts/reply.formats.md` | PatchSet 协议 |
| `vitest.config.ts` / `package.json` | 测试脚本与 vitest |
| `docs/plans/01-patch-engine/plan.md` | 本记录 |
