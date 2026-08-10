import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compileProject } from "./core.mjs";

async function fakeCompiler(body) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "medprism-test-engine-"));
  const executable = path.join(directory, process.platform === "win32" ? "fake.cmd" : "fake");
  if (process.platform === "win32") {
    await fs.writeFile(executable, `@echo off\r\n${body}\r\n`, "utf8");
  } else {
    await fs.writeFile(executable, `#!/bin/sh\nset -eu\n${body}\n`, "utf8");
    await fs.chmod(executable, 0o755);
  }
  return { directory, executable };
}

describe.skipIf(process.platform === "win32")("Electron compile core", () => {
  it("compiles without HTTP/Vite and preserves the project revision", async () => {
    const fake = await fakeCompiler('args="$*"\ncase " $args " in *" --untrusted "*) ;; *) exit 9 ;; esac\nfor main do :; done\nprintf "%s" "%PDF-1.4 fake" > "${main%.tex}.pdf"');
    try {
      const revision = "a".repeat(64);
      const result = await compileProject(
        { files: { "main.tex": "\\documentclass{article}" }, mainFile: "main.tex", projectRevision: revision },
        { executable: fake.executable, timeoutMs: 2000 },
      );
      expect(result.ok).toBe(true);
      expect(result.pdfBase64).toBeTruthy();
      expect(result.projectRevision).toBe(revision);
    } finally {
      await fs.rm(fake.directory, { recursive: true, force: true });
    }
  });

  it("rejects traversal before spawning", async () => {
    const result = await compileProject({ files: { "../evil.tex": "x" }, mainFile: "../evil.tex" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("UNSAFE_PATH");
  });

  it("supports timeout and cancellation", async () => {
    const fake = await fakeCompiler("sleep 2");
    try {
      const timed = await compileProject(
        { files: { "main.tex": "x" }, mainFile: "main.tex" },
        { executable: fake.executable, timeoutMs: 20 },
      );
      expect(timed.code).toBe("TIMEOUT");

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 20);
      const cancelled = await compileProject(
        { files: { "main.tex": "x" }, mainFile: "main.tex" },
        { executable: fake.executable, timeoutMs: 2000, signal: controller.signal },
      );
      expect(cancelled.code).toBe("CANCELLED");
    } finally {
      await fs.rm(fake.directory, { recursive: true, force: true });
    }
  });
});
