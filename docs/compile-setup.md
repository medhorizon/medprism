# Compile setup (Plan7A / Plan8B)

MedPrism uses a local **Tectonic** service for real PDF compilation.

Official installers already bundle Tectonic 0.17.0. The steps below are
for development from source, or if you override the engine.

## 1. Install Tectonic

- Windows: download from [Tectonic releases](https://github.com/tectonic-typesetting/tectonic/releases) or `scoop install tectonic` / `choco install tectonic`
- macOS: `brew install tectonic`
- Linux: see [tectonic-typesetting.github.io](https://tectonic-typesetting.github.io/)

Verify:

```bash
tectonic --version
```

## 2. Start the compile server

From the repo root:

```bash
npm run compile:server
```

Listens on `http://127.0.0.1:8788` (`PORT` env overrides).

## 3. Frontend proxy

`vite.config.ts` proxies `/api` → `http://127.0.0.1:8788`.

Run the app as usual:

```bash
npm run dev
```

## 4. API

`POST /api/compile`

```json
{
  "mainFile": "main.tex",
  "files": {
    "main.tex": "\\documentclass{article}\\begin{document}Hi\\end{document}"
  }
}
```

Response:

```json
{
  "ok": true,
  "log": "...",
  "pdfBase64": "JVBERi0x..."
}
```
