# MedPrism

Medical scientific writing workspace inspired by OpenAI Prism (graphite-on-paper UI, Assistant card under Source).

## Download (v1.5.1)

Prebuilt desktop apps: [GitHub Releases](https://github.com/medhorizon/medprism/releases/tag/v1.5.1)

| Platform | Artifact |
|---|---|
| Windows x64 | `MedPrism-1.5.1-win64-portable.exe` |
| Linux x64 | `MedPrism-1.5.1-linux64.AppImage` |
| macOS Apple Silicon | `MedPrism-1.5.1-macos-arm64.dmg` |

## Run (development)

```bash
npm install
cp .env.example .env          # once 鈥?sets VITE_AUTH_BASE_URL
npm run auth:server           # terminal 1 鈥?email OTP + hosted proxy (port 8787)
npm run dev                   # terminal 2 鈥?UI
# optional:
npm run compile:server        # local Tectonic
# desktop shell (after `npm run dev` or against packaged dist):
npm run electron:dev
```

Auth: [docs/auth-setup.md](./docs/auth-setup.md) 路 Compile: [docs/compile-setup.md](./docs/compile-setup.md) 路 Real-auth plan: [PLAN01-REAL-AUTH.md](./PLAN01-REAL-AUTH.md) 路 V1 optimization plans: [docs/plans/](./docs/plans/README.md).

Routes:

- `/login` 鈥?email verification-code login / guest
- `/projects` 鈥?project list + API settings
- `/p/:projectId` 鈥?workspace editor锛圓ssistant锛氳嚜鐒惰瑷€ +銆屽闃呰鏂囥€嶈姱鐗囷級

## Directory

```text
AGENTS.md                 # agent protocol (Plan4)
PLAN.md / PLAN01-REAL-AUTH.md / PLAN08.md
docs/plans/               # V1 executable optimization plans (MASTER + P01鈥揚10)
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

Projects 鈫?浠庢ā鏉挎柊寤恒€傚畼鏂瑰寘鍦?`templates/official/`銆傝 [templates/README.md](./templates/README.md)銆?
## Language

榛樿涓枃 UI锛涚櫥褰曢〉 / 椤圭洰椤?/ 椤舵爮鍙垏鎹?English锛堝瓨 `localStorage`锛夈€?
## Roadmap

See [PLAN.md](./PLAN.md), [PLAN01.md](./PLAN01.md)锛堚渽 鐧诲綍閴存潈瀹屾垚锛? and [PLAN08.md](./PLAN08.md). Includes login/API config, PaperSearch citation tools, and local Tectonic compile fix loop.
