import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  bibliographyFailure,
  compileProject,
  exportWordProject,
  filesWithRootBibliographyStyles,
  importDocxProject,
  validateCompileRequest,
} from "./core.mjs";

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

describe("compile request validation", () => {
  it("measures binary assets after base64 decoding", () => {
    const raw = Buffer.alloc(1_600_000, 1);
    const binary = `medprism-binary/v1;base64,${raw.toString("base64")}`;
    expect(() =>
      validateCompileRequest({
        files: { "main.tex": "\\includegraphics{figures/result.png}", "figures/result.png": binary },
        mainFile: "main.tex",
      }),
    ).not.toThrow();
  });

  it("accepts only a boolean SyncTeX option", () => {
    expect(validateCompileRequest({
      files: { "main.tex": "x" },
      mainFile: "main.tex",
      synctex: true,
    }).synctex).toBe(true);
    expect(() => validateCompileRequest({
      files: { "main.tex": "x" },
      mainFile: "main.tex",
      synctex: "true",
    })).toThrow(/synctex must be boolean/);
  });
});

describe("bibliography compile validation", () => {
  it("rejects Tectonic's successful exit when BibTeX errors were ignored", () => {
    expect(bibliographyFailure("warning: errors were issued by BibTeX, but were ignored")).toBe(true);
    expect(bibliographyFailure(
      "note: Running TeX\nPackage natbib Warning: There were undefined citations.",
    )).toBe(true);
    expect(bibliographyFailure(
      "note: Running TeX\nPackage natbib Warning: There were undefined citations.\n" +
      "note: Rerunning TeX because I was told to\nOutput written on main.xdv",
    )).toBe(false);
    expect(bibliographyFailure("note: warnings were issued by BibTeX")).toBe(false);
  });

  it("makes one nested bibliography style visible to root-level BibTeX", () => {
    expect(filesWithRootBibliographyStyles({
      "main.tex": "\\bibliographystyle{journal}",
      "bst/journal.bst": "style",
    })).toMatchObject({
      "bst/journal.bst": "style",
      "journal.bst": "style",
    });
  });

  it("does not guess between duplicate nested bibliography styles", () => {
    const files = filesWithRootBibliographyStyles({
      "a/journal.bst": "a",
      "b/journal.bst": "b",
    });
    expect(files["journal.bst"]).toBeUndefined();
  });
});

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

  it("returns SyncTeX data only when requested", async () => {
    const fake = await fakeCompiler('args="$*"\ncase " $args " in *" --synctex "*) ;; *) exit 9 ;; esac\nfor main do :; done\nprintf "%s" "%PDF-1.4 fake" > "${main%.tex}.pdf"\nprintf "%s" "SyncTeX Version:1" | gzip > "${main%.tex}.synctex.gz"');
    try {
      const result = await compileProject(
        { files: { "main.tex": "x" }, mainFile: "main.tex", synctex: true },
        { executable: fake.executable, timeoutMs: 2000 },
      );
      expect(result.ok).toBe(true);
      expect(Buffer.from(result.synctexBase64, "base64").subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    } finally {
      await fs.rm(fake.directory, { recursive: true, force: true });
    }
  });

  it("fails an explicit SyncTeX request when the artifact is missing", async () => {
    const fake = await fakeCompiler('for main do :; done\nprintf "%s" "%PDF-1.4 fake" > "${main%.tex}.pdf"');
    try {
      const result = await compileProject(
        { files: { "main.tex": "x" }, mainFile: "main.tex", synctex: true },
        { executable: fake.executable, timeoutMs: 2000 },
      );
      expect(result.ok).toBe(false);
      expect(result.code).toBe("SYNCTEX_MISSING");
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

function fakePandocSpawn({ writeBytes, empty = false } = {}) {
  return (executable, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    setImmediate(() => {
      if (!empty) {
        const output = args[args.indexOf("-o") + 1];
        const full = path.resolve(options.cwd, output);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, writeBytes ?? Buffer.from("PK\x03\x04fake-docx"));
      }
      child.emit("close", 0, null);
    });
    return child;
  };
}

describe("Word export", () => {
  it("returns ok and docxBase64 when pandoc writes a document", async () => {
    const payload = Buffer.from("PK\x03\x04fake-docx");
    const result = await exportWordProject(
      { files: { "main.tex": "\\documentclass{article}\\begin{document}你好\\end{document}" }, mainFile: "main.tex" },
      { spawnImpl: fakePandocSpawn({ writeBytes: payload }), timeoutMs: 2000 },
    );
    expect(result.ok).toBe(true);
    expect(result.docxBase64).toBe(payload.toString("base64"));
  });

  it("returns OUTPUT_MISSING when pandoc exits 0 without writing a document", async () => {
    const result = await exportWordProject(
      { files: { "main.tex": "x" }, mainFile: "main.tex" },
      { spawnImpl: fakePandocSpawn({ empty: true }), timeoutMs: 2000 },
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("OUTPUT_MISSING");
  });

  it("returns ENGINE_UNAVAILABLE when the executable does not exist", async () => {
    const result = await exportWordProject(
      { files: { "main.tex": "x" }, mainFile: "main.tex" },
      { executable: path.join(os.tmpdir(), `medprism-missing-pandoc-${Date.now()}`), timeoutMs: 2000 },
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("ENGINE_UNAVAILABLE");
    expect(result.error).toBe("Pandoc not found");
  });

  it("rewrites journal authors and passes a reference document to pandoc", async () => {
    const payload = Buffer.from("PK\x03\x04fake-docx");
    let capturedArgs;
    let capturedTex;
    const spawnImpl = (executable, args, options) => {
      capturedArgs = args;
      capturedTex = readFileSync(path.resolve(options.cwd, "main.tex"), "utf8");
      return fakePandocSpawn({ writeBytes: payload })(executable, args, options);
    };
    const result = await exportWordProject(
      {
        files: {
          "main.tex": [
            "\\documentclass{sn-jnl}",
            "\\begin{document}",
            "\\title{Paper}",
            "\\author*[1]{\\fnm{Ada} \\sur{Lovelace}}\\email{ada@lab.edu}",
            "\\affil[1]{\\orgname{Lab}}",
            "\\maketitle",
            "Hi.",
            "\\end{document}",
            "",
          ].join("\n"),
        },
        mainFile: "main.tex",
      },
      { spawnImpl, timeoutMs: 2000 },
    );
    expect(result.ok).toBe(true);
    expect(capturedArgs).toContain("--reference-doc");
    expect(capturedTex).toContain("Ada Lovelace");
    expect(capturedTex).toContain("Corresponding author");
    expect(capturedTex).toContain("ada@lab.edu");
  });
});

describe("Word import", () => {
  const docxBase64 = Buffer.from("fake-docx").toString("base64");

  it("returns utf8 markdown including CJK when pandoc writes out.md", async () => {
    const markdown = "\uFEFF# 中文标题\n";
    const result = await importDocxProject(
      { docxBase64 },
      { spawnImpl: fakePandocSpawn({ writeBytes: Buffer.from(markdown, "utf8") }), timeoutMs: 2000 },
    );
    expect(result.ok).toBe(true);
    expect(result.markdown).toContain("中文标题");
    expect(result.markdown?.startsWith("\uFEFF")).toBe(false);
  });

  it("returns OUTPUT_MISSING when pandoc writes empty markdown", async () => {
    const result = await importDocxProject(
      { docxBase64 },
      { spawnImpl: fakePandocSpawn({ writeBytes: Buffer.from("  \n", "utf8") }), timeoutMs: 2000 },
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("OUTPUT_MISSING");
  });

  it("returns ENGINE_UNAVAILABLE when the executable does not exist", async () => {
    const result = await importDocxProject(
      { docxBase64 },
      { executable: path.join(os.tmpdir(), `medprism-missing-pandoc-${Date.now()}`), timeoutMs: 2000 },
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("ENGINE_UNAVAILABLE");
    expect(result.error).toBe("Pandoc not found");
  });
});
