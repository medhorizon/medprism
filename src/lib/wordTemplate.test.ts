import { describe, expect, it } from "vitest";
import {
  LLM_MARKDOWN_CHAR_LIMIT,
  parseGeneratedLatexProject,
  prepareMarkdownForLlm,
  validateLatexStructure,
  wordMarkdownToLatexPrompt,
} from "./wordTemplate";

const VALID_TEX = [
  "\\documentclass{article}",
  "\\begin{document}",
  "\\title{Hello}",
  "\\section{Intro}",
  "Hi.",
  "\\end{document}",
  "",
].join("\n");

function envelope(files: Record<string, string>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    title: "Demo",
    mainFile: "main.tex",
    files,
    ...extra,
  });
}

describe("parseGeneratedLatexProject", () => {
  it("accepts a valid project", () => {
    const project = parseGeneratedLatexProject(envelope({ "main.tex": VALID_TEX }));
    expect(project.schemaVersion).toBe(1);
    expect(project.mainFile).toBe("main.tex");
    expect(project.files["main.tex"]).toContain("\\title{Hello}");
    expect(Array.isArray(project.files)).toBe(false);
  });

  it("rejects files as an array", () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      mainFile: "main.tex",
      files: [{ path: "main.tex", content: VALID_TEX }],
    });
    expect(() => parseGeneratedLatexProject(raw)).toThrow(/files must be a non-array object/);
  });

  it("rejects unclosed \\title{", () => {
    const tex = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\title{Hello",
      "\\end{document}",
      "",
    ].join("\n");
    expect(() => parseGeneratedLatexProject(envelope({ "main.tex": tex }))).toThrow(/unclosed brace/);
  });

  it("rejects unmatched \\begin{document}", () => {
    const tex = ["\\documentclass{article}", "\\begin{document}", "Hi", ""].join("\n");
    expect(() => parseGeneratedLatexProject(envelope({ "main.tex": tex }))).toThrow(
      /unclosed \\begin\{document\}/,
    );
  });

  it("rejects an extra }", () => {
    const tex = [
      "\\documentclass{article}",
      "\\begin{document}",
      "Hi}",
      "\\end{document}",
      "",
    ].join("\n");
    expect(() => parseGeneratedLatexProject(envelope({ "main.tex": tex }))).toThrow(
      /unmatched closing brace/,
    );
  });

  it("rejects CJK source Markdown when generated tex has no CJK", () => {
    expect(() =>
      parseGeneratedLatexProject(envelope({ "main.tex": VALID_TEX }), {
        sourceMarkdown: "# 中文摘要\n",
      }),
    ).toThrow(/CJK/);
  });

  it("rejects U+FFFD and 锟斤拷", () => {
    expect(() =>
      parseGeneratedLatexProject(envelope({ "main.tex": VALID_TEX.replace("Hi.", "\uFFFD") })),
    ).toThrow(/mojibake/);
    expect(() =>
      parseGeneratedLatexProject(envelope({ "main.tex": VALID_TEX.replace("Hi.", "锟斤拷") })),
    ).toThrow(/mojibake/);
  });

  it("rejects UTF-8-as-Latin1 mojibake in tex", () => {
    expect(() =>
      parseGeneratedLatexProject(
        envelope({ "main.tex": VALID_TEX.replace("Hi.", "ä¸­æ–‡æ‘˜è¦") }),
      ),
    ).toThrow(/mojibake/);
  });

  it("accepts CJK source Markdown when tex keeps CJK", () => {
    const tex = VALID_TEX.replace("Hi.", "中文摘要");
    const project = parseGeneratedLatexProject(envelope({ "main.tex": tex }), {
      sourceMarkdown: "# 中文摘要\n",
    });
    expect(project.files["main.tex"]).toContain("中文摘要");
  });

  it("extracts JSON from a markdown fence", () => {
    const fenced = `Here is the project:\n\`\`\`json\n${envelope({ "main.tex": VALID_TEX })}\n\`\`\`\n`;
    const project = parseGeneratedLatexProject(fenced);
    expect(project.files["main.tex"]).toContain("\\section{Intro}");
  });

  it("drops model-generated PDF and binary payloads", () => {
    const project = parseGeneratedLatexProject(
      envelope({
        "main.tex": VALID_TEX,
        "main.pdf": "medprism-binary/v1;base64,JVBERi0xLjU=",
        "notes.txt": "ignore me",
      }),
    );
    expect(project.files).toEqual({ "main.tex": VALID_TEX });
  });
});

describe("validateLatexStructure", () => {
  it("skips braces inside simple \\verb", () => {
    const tex = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\verb|{| ok \\verb*}|}",
      "\\end{document}",
      "",
    ].join("\n");
    expect(validateLatexStructure(tex)).toEqual({ ok: true });
  });

  it("ignores commented \\begin and \\end", () => {
    const tex = [
      "\\documentclass{article}",
      "\\begin{document}",
      "% \\begin{figure}",
      "ok",
      "\\end{document}",
      "",
    ].join("\n");
    expect(validateLatexStructure(tex)).toEqual({ ok: true });
  });
});

describe("prepareMarkdownForLlm", () => {
  it("strips data URI images and keeps path images as omitted placeholders", () => {
    const prepared = prepareMarkdownForLlm(
      'See ![plot](data:image/png;base64,iVBORw0KGgo=) and ![fig](figures/a.png) <img src="data:image/png;base64,abcd">.',
    );
    expect(prepared).not.toMatch(/data:image/);
    expect(prepared).not.toContain("iVBORw0KGgo");
    expect(prepared).toContain("[image omitted]");
    expect(prepared).toContain("[image omitted: figures/a.png]");
  });

  it("truncates over the LLM character limit", () => {
    const prepared = prepareMarkdownForLlm("x".repeat(LLM_MARKDOWN_CHAR_LIMIT + 20));
    expect(prepared.endsWith("\n\n[truncated]")).toBe(true);
    expect(prepared.length).toBe(LLM_MARKDOWN_CHAR_LIMIT + "\n\n[truncated]".length);
  });
});

describe("wordMarkdownToLatexPrompt", () => {
  it("contains Do not invent and IMRAD wrap language", () => {
    const prompt = wordMarkdownToLatexPrompt("# Introduction\nKeep this sentence.");
    expect(prompt.system).toMatch(/Do not invent/);
    expect(prompt.system).toMatch(/IMRAD/);
    expect(prompt.system).toMatch(/wrap/i);
    expect(prompt.system).toMatch(/ctexart/);
    expect(prompt.system).toMatch(/Do not include PDF/);
    expect(prompt.system).toMatch(/\\maketitle/);
    expect(prompt.user).toContain('kind="word-markdown"');
    expect(prompt.user).toContain("untrusted-data");
  });
});
