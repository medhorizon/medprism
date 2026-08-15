# Bundled Tectonic engines

MedPrism resolves Tectonic in this order:

1. `MEDPRISM_TECTONIC_PATH`
2. packaged `resources/tectonic/<platform>-<arch>/tectonic[.exe]`
3. `tectonic` on `PATH`

`npm run electron:pack:*` downloads Tectonic 0.17.0 into the matching
folder (`win32-x64`, `linux-x64`, `darwin-arm64`) before electron-builder
copies it into the installer. Binaries stay gitignored.

```bash
npm run fetch-tectonic
```
