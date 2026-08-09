# Plan8 · 可插拔工具链（已落地摘要）

> Citation（Europe PMC → BibTeX）+ Compile Fix（Tectonic log → suggestion → 可选再编译）。

## 模块

| 路径 | 职责 |
|---|---|
| `src/tools/*` | Tool 协议、registry、`paper_search` / `compile` / `parse_compile_log` |
| `src/lib/assistantRuntime.ts` | 助手（NL 自动路由；审阅芯片/话术触发 review） |
| `src/lib/compileClient.ts` | `POST /api/compile` |
| `src/lib/replyParse.ts` | suggestion / JSON 回复解析 |
| `server/compile/` | 本机 Tectonic 服务 |
| `docs/compile-setup.md` | 安装与启动说明 |

## 使用

```bash
# 终端 1
npm run compile:server

# 终端 2
npm run dev
```

Assistant 用自然语言自动选 skill 与工具；快捷芯片 **「审阅论文」** 走审稿 Skill。  
引用类问题会先跑 `paper_search`；编译失败可用 Fix with AI（Keep 后最多再编译 2 次）。
