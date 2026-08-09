# P02 — activeFile / Selection 上下文接线

**Status:** ⬜ Not started  
**Priority:** P0  
**Depends on:** 可独立开发；与 P01 联调后才形成可靠编辑闭环  
**Blocks:** P05 Citation、P06 Compile-Fix、writing/polish 的“只改这段”

---

## 1. 目标

用户说：

> “润色这段”  
> “只改我选中的内容”  
> “修当前文件这里”

时，模型必须准确知道：

- 当前打开哪个文件；
- 选中了什么；
- 选区在文件中的位置；
- 必要时选区前后少量上下文。

---

## 2. 当前断点

重点检查：

- `AGENTS.md`
- `src/components/SourcePane.tsx`
- `src/pages/WorkspacePage.tsx`
- `src/tools/types.ts`
- `src/lib/assistantRuntime.ts`

`WorkspacePage` 已有 active file state，但当前 runtime context 没有完整传递 `activeFile / selection / selectedText`。

---

## 3. 本计划范围

### 必须做

- activeFile
- selectedText
- selection range
- SourcePane selection change
- WorkspacePage 状态
- ToolContext 接线
- task-specific context builder
- selection 越界限制

### 暂不做

- 全项目语义索引
- SQLite index
- embedding/RAG
- AST-level source map
- 光标智能预测
- 通用 Context Engine

---

## 4. Context 类型

修改 `src/tools/types.ts`：

```ts
export type TextSelection = {
  start: number;
  end: number;
};

export type ToolContext = {
  projectId: string;
  files: Record<string, string>;
  mainFile?: string;
  activeFile?: string;
  selectedText?: string;
  selection?: TextSelection;
  lastCompileLog?: string;
};
```

约束：

- `0 <= start <= end <= activeFile.length`
- `selectedText === files[activeFile].slice(start, end)`
- 不一致时以程序重新切片结果为准，不信任传入的 selectedText。

---

## 5. 实施步骤

### Step 1 — SourcePane 暴露 selection

修改 `src/components/SourcePane.tsx`：

- [ ] 增加 `onSelectionChange`。
- [ ] textarea/editor 在 select、mouse up、keyboard selection 变化时上报。
- [ ] 上报 start/end。
- [ ] 切换文件时清空旧 selection。
- [ ] selection 为 collapsed 时可视为“无选区”。

### Step 2 — WorkspacePage 保存 UI context

修改 `src/pages/WorkspacePage.tsx`：

- [ ] 保存 `selection` state。
- [ ] 根据 active file 内容实时计算 `selectedText`。
- [ ] 切换 activeFile 时 reset selection。
- [ ] 调用 `runAssistant()` 时传入 activeFile / selection / selectedText。
- [ ] AI Action（Polish/Cite 等）也使用同一 context。

### Step 3 — 建立轻量 Context Builder

新增：

`src/lib/context/buildContext.ts`

规则：

#### 有 selection

发送：

- active file path
- exact selectedText
- 选区前后有限上下文
- 必要的 main file metadata
- 当前请求

#### 无 selection、有 activeFile

发送：

- active file
- 必要范围的 active file 内容
- main file 仅在确有必要时补充

#### compile-fix

优先由 P06 提供：

- error path
- error line
- 附近代码

#### review

明确记录实际读取了哪些文件。

### Step 4 — Prompt 明确范围

增加明确 runtime instruction：

```text
Target file: <activeFile>
Selection range: <start>-<end>

If the user requests "only this selection", any Patch operation must remain
within the selected source text. Do not modify unrelated text.
```

### Step 5 — 与 P01 Patch 联调

- [ ] selection revise 的 `replace_text.oldText` 默认等于 selectedText。
- [ ] Patch `path` 默认等于 activeFile。
- [ ] 如果模型返回其他 path，除非 workflow 明确允许多文件修改，否则 reject。
- [ ] “只改选区”时 `oldText` 必须完全位于 selection 内。

---

## 6. 测试

至少覆盖：

- [ ] `main.tex` 选区。
- [ ] `sections/methods.tex` 选区。
- [ ] active file 非 main file。
- [ ] selection 切换文件后被清空。
- [ ] selectedText 与 range 一致。
- [ ] 用户编辑后原 selection 失效。
- [ ] “只改选区” Patch 越界被拒绝。
- [ ] 无 selection 时使用 active file，而不是永远使用 main excerpt。

准备至少 20 组 fixture。

---

## 7. UI 最低反馈

Assistant 请求旁可显示简单 Context chip：

```text
Context: sections/methods.tex · selected 438 chars
```

至少让用户知道模型本次收到的是哪一个文件/选区。

---

## 8. Definition of Done

- [ ] activeFile 100% 进入 runtime。
- [ ] selection 存在时 selectedText 与 UI 完全一致。
- [ ] active file 非 main 时不再默认只给模型 main 前 2500 字符。
- [ ] “只改选区”不会越界。
- [ ] Patch target 默认使用 activeFile。
- [ ] 20 组 selection fixture 通过。
- [ ] 与 P01 联调通过。

---

## 9. 实施记录

- PR:
- Commit:
- 新增测试:
- 已知限制:
- Master Plan 状态已更新: [ ]
