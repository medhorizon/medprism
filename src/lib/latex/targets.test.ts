import { describe, expect, it } from "vitest";
import { buildContextSnapshot } from "../context/snapshot";
import { simulatePatchSet } from "../patch/simulate";
import {
  buildAbstractPatch,
  escapeLatexPlainText,
  locateLatexCommands,
  maskLatexComments,
  resolveAbstractTarget,
  structuralMask,
} from "./targets";

async function snapshot(source: string) {
  return buildContextSnapshot({
    projectId: "project-1",
    files: { "sn-article.tex": source },
    mainFile: "sn-article.tex",
    activeFile: "sn-article.tex",
  });
}

describe("LaTeX abstract targeting", () => {
  it("ignores commented examples and locates the active Springer abstract", async () => {
    const source = [
      "\\documentclass[pdflatex,sn-mathphys-num]{sn-jnl}",
      "% \\abstract{Commented example}",
      "\\begin{document}",
      "\\abstract{Template abstract with \\textbf{nested braces}.}",
      "\\maketitle",
      "\\end{document}",
    ].join("\n");
    const context = await snapshot(source);
    const resolved = resolveAbstractTarget(context);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.target.syntax).toBe("command");
    expect(resolved.target.existingText).toBe("Template abstract with \\textbf{nested braces}.");

    const built = await buildAbstractPatch(
      context,
      resolved.target,
      "HCC is a clinically important liver malignancy.",
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const simulated = await simulatePatchSet({ ...context.files }, built.patchSet);
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) return;
    expect(simulated.simulation.nextFiles["sn-article.tex"]).toContain(
      "\\abstract{HCC is a clinically important liver malignancy.}",
    );
    expect(simulated.simulation.nextFiles["sn-article.tex"]).toContain(
      "% \\abstract{Commented example}",
    );
  });

  it("ignores abstract examples inside verbatim documentation", async () => {
    const source = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\begin{verbatim}",
      "\\abstract{Documentation example}",
      "\\end{verbatim}",
      "\\begin{abstract}",
      "Active abstract.",
      "\\end{abstract}",
      "\\end{document}",
    ].join("\n");
    const context = await snapshot(source);
    const resolved = resolveAbstractTarget(context);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.target.syntax).toBe("environment");
    expect(resolved.target.existingText.trim()).toBe("Active abstract.");
  });

  it("replaces an abstract environment body", async () => {
    const source = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\begin{abstract}",
      "Old abstract.",
      "\\end{abstract}",
      "\\end{document}",
    ].join("\n");
    const context = await snapshot(source);
    const resolved = resolveAbstractTarget(context);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.target.syntax).toBe("environment");
    const built = await buildAbstractPatch(context, resolved.target, "New abstract.");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const simulated = await simulatePatchSet({ ...context.files }, built.patchSet);
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) return;
    expect(simulated.simulation.nextFiles["sn-article.tex"]).toContain(
      "\\begin{abstract}\nNew abstract.\n\\end{abstract}",
    );
  });

  it("uses an exact-range replacement to insert a generic abstract after maketitle", async () => {
    const source = [
      "\\documentclass{article}",
      "% \\maketitle",
      "\\begin{document}",
      "\\maketitle",
      "Body.",
      "\\end{document}",
    ].join("\n");
    const context = await snapshot(source);
    const resolved = resolveAbstractTarget(context);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.target.mode).toBe("insert_after");
    const built = await buildAbstractPatch(context, resolved.target, "Inserted abstract.");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.patchSet.operations[0]?.op).toBe("replace_text");
    const simulated = await simulatePatchSet({ ...context.files }, built.patchSet);
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) return;
    expect(simulated.simulation.nextFiles["sn-article.tex"]).toContain(
      "\\maketitle\n\n\\begin{abstract}\nInserted abstract.\n\\end{abstract}",
    );
  });

  it("inserts an ACM abstract before maketitle", async () => {
    const source = [
      "\\documentclass[sigconf]{acmart}",
      "\\begin{document}",
      "\\maketitle",
      "Body.",
      "\\end{document}",
    ].join("\n");
    const context = await snapshot(source);
    const resolved = resolveAbstractTarget(context);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.target.mode).toBe("insert_before");
    const built = await buildAbstractPatch(context, resolved.target, "ACM abstract.");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const simulated = await simulatePatchSet({ ...context.files }, built.patchSet);
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) return;
    expect(simulated.simulation.nextFiles["sn-article.tex"]).toContain(
      "\\begin{abstract}\nACM abstract.\n\\end{abstract}\n\n\\maketitle",
    );
  });

  it("prefers the main document abstract over an unrelated active-file abstract", async () => {
    const mainSource = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\begin{abstract}",
      "Main manuscript abstract.",
      "\\end{abstract}",
      "\\input{sections/notes}",
      "\\end{document}",
    ].join("\n");
    const notesSource = [
      "\\begin{abstract}",
      "Unrelated embedded example.",
      "\\end{abstract}",
    ].join("\n");
    const context = await buildContextSnapshot({
      projectId: "project-1",
      files: {
        "main.tex": mainSource,
        "sections/notes.tex": notesSource,
      },
      mainFile: "main.tex",
      activeFile: "sections/notes.tex",
    });
    const resolved = resolveAbstractTarget(context);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.target.path).toBe("main.tex");
    expect(resolved.target.existingText.trim()).toBe("Main manuscript abstract.");
  });

  it("preserves offsets while masking comments", () => {
    const source = "a% hidden\\n\\abstract{visible}".replace("\\n", "\n");
    const masked = maskLatexComments(source);
    expect(masked).toHaveLength(source.length);
    expect(masked).not.toContain("hidden");
    expect(masked).toContain("\\abstract{visible}");
  });

  it("escapes LaTeX-special characters in plain model prose", () => {
    expect(escapeLatexPlainText("A&B_50% #1")).toBe("A\\&B\\_50\\% \\#1");
  });

  it("locates commands with optional arguments without matching longer names", () => {
    const source = [
      "\\titlepage",
      "\\title[Short]{Full Title}",
      "\\abstract[heading]{Abstract with \\textbf{nested} text.}",
      "\\section*[Methods]{Methods}",
    ].join("\n");
    const masked = structuralMask(source);
    const titles = locateLatexCommands(source, masked, "title");
    expect(titles).toHaveLength(1);
    expect(titles[0]!.optionalArg).toBe("Short");
    expect(source.slice(titles[0]!.bodyStart, titles[0]!.bodyEnd)).toBe("Full Title");

    const abstracts = locateLatexCommands(source, masked, "abstract");
    expect(abstracts).toHaveLength(1);
    expect(abstracts[0]!.optionalArg).toBe("heading");
    expect(source.slice(abstracts[0]!.bodyStart, abstracts[0]!.bodyEnd)).toBe(
      "Abstract with \\textbf{nested} text.",
    );

    const sections = locateLatexCommands(source, masked, "section", { allowStar: true });
    expect(sections).toHaveLength(1);
    expect(sections[0]!.star).toBe(true);
    expect(sections[0]!.optionalArg).toBe("Methods");
    expect(source.slice(sections[0]!.bodyStart, sections[0]!.bodyEnd)).toBe("Methods");
  });

  it("resolves \\abstract[opt]{body} through the shared command locator", async () => {
    const source = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\abstract[Summary]{Active abstract body.}",
      "\\end{document}",
    ].join("\n");
    const context = await buildContextSnapshot({
      projectId: "project-1",
      files: { "main.tex": source },
      mainFile: "main.tex",
      activeFile: "main.tex",
    });
    const resolved = resolveAbstractTarget(context);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.target.existingText).toBe("Active abstract body.");
    expect(resolved.target.openingAnchor).toBe("\\abstract[Summary]{");
  });
});

