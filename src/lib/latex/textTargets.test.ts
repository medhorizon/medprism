import { describe, expect, it } from "vitest";
import { buildContextSnapshot } from "../context/snapshot";
import { simulatePatchSet } from "../patch/simulate";
import { buildLatexTextPatch, resolveLatexTarget } from "./textTargets";
import type { LatexTargetSpec } from "./types";

async function snapshot(source: string, args: {
  activeFile?: string;
  mainFile?: string;
  selection?: { start: number; end: number };
} = {}) {
  return buildContextSnapshot({
    projectId: "project-1",
    files: { "main.tex": source },
    activeFile: args.activeFile ?? "main.tex",
    mainFile: args.mainFile ?? "main.tex",
    ...(args.selection ? { selection: args.selection } : {}),
  });
}

async function applyTarget(source: string, spec: LatexTargetSpec, text: string) {
  const context = await snapshot(source);
  const resolved = resolveLatexTarget(context, spec);
  expect(resolved.ok).toBe(true);
  if (!resolved.ok) throw new Error(resolved.message);
  const built = await buildLatexTextPatch({
    snapshot: context,
    target: resolved.target,
    text,
    format: "plain-text",
  });
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error(built.message);
  const simulated = await simulatePatchSet({ ...context.files }, built.patchSet);
  expect(simulated.ok).toBe(true);
  if (!simulated.ok) throw new Error(simulated.error.message);
  return simulated.simulation.nextFiles["main.tex"]!;
}

describe("general LaTeX text targets", () => {
  it.each([
    ["methods", "Methods", "New methods prose."],
    ["discussion", "Discussion", "New discussion prose."],
    ["funding", "Funding", "New funding statement."],
  ] as const)("replaces the existing %s section body", async (kind, heading, replacement) => {
    const source = [
      "\\documentclass{article}",
      "\\begin{document}",
      `\\section${kind === "funding" ? "*" : ""}{${heading}}`,
      "Old section body.",
      "\\end{document}",
    ].join("\n");
    const result = await applyTarget(source, { kind, createIfMissing: true }, replacement);
    expect(result).toContain(replacement);
    expect(result).not.toContain("Old section body.");
    expect(result).toContain(`{${heading}}`);
  });

  it("creates a missing discussion before the document end", async () => {
    const source = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\section{Results}",
      "Results body.",
      "\\end{document}",
    ].join("\n");
    const result = await applyTarget(
      source,
      { kind: "discussion", createIfMissing: true },
      "A new discussion.",
    );
    expect(result).toContain("\\section{Discussion}\nA new discussion.");
    expect(result.indexOf("\\section{Discussion}")).toBeLessThan(result.indexOf("\\end{document}"));
  });

  it("creates a custom section through the same target adapter", async () => {
    const source = "\\documentclass{article}\n\\begin{document}\nBody.\n\\end{document}";
    const result = await applyTarget(
      source,
      { kind: "section", sectionTitle: "Limitations", createIfMissing: true },
      "The study has several limitations.",
    );
    expect(result).toContain("\\section{Limitations}");
    expect(result).toContain("The study has several limitations.");
  });

  it("replaces an exact selection and keeps runtime ownership of the range", async () => {
    const source = "Before selected text after.";
    const selected = "selected text";
    const start = source.indexOf(selected);
    const context = await snapshot(source, {
      selection: { start, end: start + selected.length },
    });
    const resolved = resolveLatexTarget(context, { kind: "selection" });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.target.range).toEqual({ start, end: start + selected.length });
    const built = await buildLatexTextPatch({
      snapshot: context,
      target: resolved.target,
      text: "revised text",
      format: "plain-text",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const simulated = await simulatePatchSet({ ...context.files }, built.patchSet);
    expect(simulated.ok).toBe(true);
    if (!simulated.ok) return;
    expect(simulated.simulation.nextFiles["main.tex"]).toBe("Before revised text after.");
  });

  it("requires latex-body when replacing a target that contains LaTeX structure", async () => {
    const source = [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\section{Methods}",
      "We used \\textbf{strict} criteria and $p < 0.05$.",
      "\\end{document}",
    ].join("\n");
    const context = await snapshot(source);
    const resolved = resolveLatexTarget(context, { kind: "methods" });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const built = await buildLatexTextPatch({
      snapshot: context,
      target: resolved.target,
      text: "Plain replacement.",
      format: "plain-text",
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.message).toMatch(/latex-body/i);
  });

  it("does not create a missing target when createIfMissing is false", async () => {
    const context = await snapshot("\\documentclass{article}\n\\begin{document}\n\\end{document}");
    const resolved = resolveLatexTarget(context, {
      kind: "funding",
      createIfMissing: false,
    });
    expect(resolved.ok).toBe(false);
  });
});
