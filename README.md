# MedPrism

Medical scientific writing workspace inspired by OpenAI Prism (graphite-on-paper UI, Assistant card under Source).

## Download (v1.0.0)

Prebuilt desktop apps: [GitHub Releases](https://github.com/medhorizon/medprism/releases/tag/v1.0.0)

| Platform | Artifact |
|---|---|
| Windows x64 | `MedPrism-1.0.0-win64-portable.exe` |
| Linux x64 | `MedPrism-1.0.0-linux64.AppImage` |
| macOS Apple Silicon | `MedPrism-1.0.0-macos-arm64.dmg` |

## Run (development)

```bash
npm install
cp .env.example .env          # once — sets VITE_AUTH_BASE_URL
npm run auth:server           # terminal 1 — email OTP + hosted proxy (port 8787)
npm run dev                   # terminal 2 — UI
# optional:
npm run compile:server        # local Tectonic
# desktop shell (after `npm run dev` or against packaged dist):
npm run electron:dev
```

Auth: [docs/auth-setup.md](./docs/auth-setup.md) · Compile: [docs/compile-setup.md](./docs/compile-setup.md) · Real-auth plan: [PLAN01-REAL-AUTH.md](./PLAN01-REAL-AUTH.md).

Routes:

- `/login` — email verification-code login / guest
- `/projects` — project list + API settings
- `/p/:projectId` — workspace editor（Assistant：自然语言 +「审阅论文」芯片）

## Directory

```text
AGENTS.md                 # agent protocol (Plan4)
PLAN.md / PLAN01-REAL-AUTH.md / PLAN08.md
templates/README.md       # template library docs
prompts/                  # system / reply formats
skills/                   # SKILL.md packages (Plan6/8)
server/auth/              # OTP login + hosted /v1 proxy
server/compile/           # local Tectonic compile service
src/
  app/                    # router shell
  pages/                  # Login / Projects / Workspace
  components/             # Topbar, FileTree, Source, Assistant, Preview
  templates/              # journal/society starter packs
  state/                  # auth / projects / llm
  tools/                  # paper_search / compile / parse_compile_log
  lib/                    # llmClient, assistantRuntime, compileClient
  styles/                 # tokens, base, workspace, shell
  data/                   # demo manuscript
  types/
```

## Template library

Projects → 从模板新建。官方包在 `templates/official/`。见 [templates/README.md](./templates/README.md)。

## Language

默认中文 UI；登录页 / 项目页 / 顶栏可切换 English（存 `localStorage`）。

## Roadmap

See [PLAN.md](./PLAN.md), [PLAN01.md](./PLAN01.md)（✅ 登录鉴权完成）, and [PLAN08.md](./PLAN08.md). Includes login/API config, PaperSearch citation tools, and local Tectonic compile fix loop.
