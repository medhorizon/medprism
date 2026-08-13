import { describe, expect, it } from "vitest";
import { prepareLatexForWordExport } from "./word-latex.mjs";

const SN = `\\documentclass[pdflatex,sn-mathphys-num]{sn-jnl}
\\begin{document}
\\title[Article Title]{Article Title}
\\author*[1,2]{\\fnm{First} \\sur{Author}}\\email{iauthor@gmail.com}
\\author[2,3]{\\fnm{Second} \\sur{Author}}\\email{iiauthor@gmail.com}
\\affil*[1]{\\orgdiv{Department}, \\orgname{Organization}, \\orgaddress{\\city{City}, \\country{Country}}}
\\abstract{The abstract serves both as a general introduction.}
\\keywords{keyword1, Keyword2}
\\maketitle
\\section{Introduction}
Body.
\\end{document}
`;

describe("prepareLatexForWordExport", () => {
  it("leaves standard article title pages unchanged", () => {
    const tex = [
      "\\documentclass{article}",
      "\\title{Hello}",
      "\\author{Ada\\thanks{Corresponding author}}",
      "\\begin{document}",
      "\\maketitle",
      "Hi.",
      "\\end{document}",
      "",
    ].join("\n");
    expect(prepareLatexForWordExport(tex)).toBe(tex);
  });

  it("rewrites Springer author/affiliation macros for Pandoc", () => {
    const prepared = prepareLatexForWordExport(SN);
    expect(prepared).toContain("\\title{Article Title}");
    expect(prepared).toContain("First Author");
    expect(prepared).toContain("Second Author");
    expect(prepared).toContain("Corresponding author");
    expect(prepared).toContain("iauthor@gmail.com");
    expect(prepared).toContain("\\begin{abstract}");
    expect(prepared).toContain("The abstract serves both as a general introduction.");
    expect(prepared).toContain("Keywords");
    expect(prepared).toContain("Department, Organization");
    expect(prepared).not.toContain("\\fnm{");
    expect(prepared).not.toContain("\\author*[");
  });
});
