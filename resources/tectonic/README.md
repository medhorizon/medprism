# Optional bundled Tectonic engines

MedPrism resolves Tectonic in this order:

1. `MEDPRISM_TECTONIC_PATH`
2. packaged `resources/tectonic/<platform>-<arch>/tectonic[.exe]`
3. `tectonic` on `PATH`

Expected packaged directories include `win32-x64`, `linux-x64`, and
`darwin-arm64`. Binaries are gitignored; place a reviewed upstream
`tectonic` / `tectonic.exe` under the matching platform folder before
`npm run electron:pack:*` so `extraResources` ships it in the portable build.
