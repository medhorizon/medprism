import { describe, expect, it } from "vitest";
import {
  BINARY_FILE_PREFIX,
  compiledPdfPath,
  decodeBinaryFile,
  encodeBinaryBase64,
  fileBytesForExport,
  filesForCompile,
  isBinaryFileContent,
  withCompiledPdfFiles,
} from "./projectBinary";

describe("projectBinary", () => {
  it("round-trips base64 payloads", () => {
    const encoded = encodeBinaryBase64("JVBERi0x");
    expect(isBinaryFileContent(encoded)).toBe(true);
    expect(encoded.startsWith(BINARY_FILE_PREFIX)).toBe(true);
    expect(new TextDecoder().decode(decodeBinaryFile(encoded)!)).toBe("%PDF-1");
  });

  it("derives pdf path from main tex", () => {
    expect(compiledPdfPath("sn-article.tex")).toBe("sn-article.pdf");
    expect(compiledPdfPath("chapters/main.TEX")).toBe("chapters/main.pdf");
  });

  it("strips pdf/binary files from compile payloads", () => {
    expect(
      filesForCompile({
        "main.tex": "\\documentclass{article}",
        "main.pdf": encodeBinaryBase64("JVBERi0x"),
        "notes.txt": "hello",
      }),
    ).toEqual({
      "main.tex": "\\documentclass{article}",
      "notes.txt": "hello",
    });
  });

  it("keeps uploaded binary images and non-generated PDFs for compilation", () => {
    const image = encodeBinaryBase64("iVBORw0KGgo=");
    const figurePdf = encodeBinaryBase64("JVBERi0x");
    expect(
      filesForCompile(
        {
          "main.tex": "\\includegraphics{figures/result.png}",
          "main.pdf": encodeBinaryBase64("JVBERi0x"),
          "figures/result.png": image,
          "figures/supplement.pdf": figurePdf,
        },
        "main.tex",
      ),
    ).toEqual({
      "main.tex": "\\includegraphics{figures/result.png}",
      "figures/result.png": image,
      "figures/supplement.pdf": figurePdf,
    });
  });

  it("exports binary files as raw bytes", () => {
    const encoded = encodeBinaryBase64(btoa("PDFDATA"));
    expect(fileBytesForExport(encoded)).toEqual(new TextEncoder().encode("PDFDATA"));
    expect(fileBytesForExport("plain")).toEqual(new TextEncoder().encode("plain"));
  });

  it("attaches compiled pdf beside the main tex file", () => {
    const next = withCompiledPdfFiles(
      { "sn-article.tex": "% tex" },
      "sn-article.tex",
      btoa("%PDF-1.4"),
      ["sn-article.tex"],
    );
    expect(Object.keys(next.files)).toContain("sn-article.pdf");
    expect(next.fileOrder).toEqual(["sn-article.tex", "sn-article.pdf"]);
    expect(decodeBinaryFile(next.files["sn-article.pdf"]!)).toEqual(
      new TextEncoder().encode("%PDF-1.4"),
    );
  });
});
