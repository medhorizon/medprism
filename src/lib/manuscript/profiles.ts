import {
  displayHeading,
  isBackmatter,
  slotFamily,
} from "./slots";
import type {
  ManuscriptModel,
  ManuscriptOccurrence,
  ManuscriptInsertion,
  ManuscriptSlotRef,
  ManuscriptSyntax,
  StructuralNode,
  TemplateProfileId,
} from "./types";

export function detectTemplateProfile(files: Readonly<Record<string, string>>): TemplateProfileId {
  const source = Object.entries(files)
    .filter(([path]) => path.toLowerCase().endsWith(".tex"))
    .map(([, content]) => content)
    .join("\n");
  if (/\\documentclass(?:\s*\[[^\]]*\])?\s*\{\s*sn-jnl\s*\}/i.test(source)) return "springer-sn";
  if (/\\documentclass(?:\s*\[[^\]]*\])?\s*\{\s*elsarticle\s*\}/i.test(source)) return "elsevier";
  if (/\\documentclass(?:\s*\[[^\]]*\])?\s*\{\s*acmart\s*\}/i.test(source)) return "acm";
  if (/\\documentclass(?:\s*\[[^\]]*\])?\s*\{\s*IEEEtran\s*\}/i.test(source)) return "ieee";
  return "generic";
}

export function canonicalScore(
  profile: TemplateProfileId,
  occurrence: ManuscriptOccurrence,
  mainFile: string,
): number {
  let score = occurrence.path === mainFile ? 100 : 0;
  if (occurrence.syntax === "declaration-item") score += profile === "springer-sn" ? 80 : 20;
  if (occurrence.syntax === "command" || occurrence.syntax === "environment") score += 20;
  return score - occurrence.wrapperRange.start / 1_000_000;
}

function node(model: ManuscriptModel, kind: StructuralNode["kind"]): StructuralNode | undefined {
  return model.structuralNodes.find(
    (candidate) => candidate.path === model.mainFile && candidate.kind === kind,
  );
}

function firstBackmatter(model: ManuscriptModel): ManuscriptOccurrence | undefined {
  return model.occurrences
    .filter((occurrence) => occurrence.path === model.mainFile && isBackmatter(occurrence.ref))
    .sort((a, b) => a.wrapperRange.start - b.wrapperRange.start)[0];
}

function firstMainSection(model: ManuscriptModel): ManuscriptOccurrence | undefined {
  return model.occurrences
    .filter((occurrence) => occurrence.path === model.mainFile && slotFamily(occurrence.ref) === "main")
    .sort((a, b) => a.wrapperRange.start - b.wrapperRange.start)[0];
}

function insertionAt(model: ManuscriptModel, ref: ManuscriptSlotRef): number | null {
  if (model.profile === "springer-sn" && isBackmatter(ref) && ref.slot !== "acknowledgements") {
    const declarationsEnd = node(model, "declarations-end");
    if (declarationsEnd) return declarationsEnd.range.start;
  }

  if (ref.slot === "title") {
    return node(model, "author")?.range.start ??
      node(model, "make-title")?.range.start ??
      node(model, "begin-document")?.range.end ?? null;
  }

  if (ref.slot === "abstract" || ref.slot === "keywords") {
    return node(model, "frontmatter-end")?.range.start ??
      node(model, "make-title")?.range.start ??
      firstMainSection(model)?.wrapperRange.start ??
      node(model, "bibliography")?.range.start ??
      node(model, "end-document")?.range.start ?? null;
  }

  if (slotFamily(ref) === "main") {
    return firstBackmatter(model)?.wrapperRange.start ??
      node(model, "bibliography")?.range.start ??
      node(model, "end-document")?.range.start ?? null;
  }

  return node(model, "bibliography")?.range.start ??
    node(model, "end-document")?.range.start ?? null;
}

export function renderEmptySlot(
  profile: TemplateProfileId,
  ref: ManuscriptSlotRef,
): { syntax: ManuscriptSyntax; text: string } {
  const heading = displayHeading(ref);
  if (ref.slot === "title") return { syntax: "command", text: "\\title{}\n" };
  if (ref.slot === "abstract") {
    return profile === "springer-sn"
      ? { syntax: "command", text: "\\abstract{}\n\n" }
      : { syntax: "environment", text: "\\begin{abstract}\n\n\\end{abstract}\n\n" };
  }
  if (ref.slot === "keywords") {
    if (profile === "elsevier") {
      return { syntax: "environment", text: "\\begin{keyword}\n\n\\end{keyword}\n\n" };
    }
    if (profile === "ieee") {
      return { syntax: "environment", text: "\\begin{IEEEkeywords}\n\n\\end{IEEEkeywords}\n\n" };
    }
    return { syntax: "command", text: "\\keywords{}\n\n" };
  }
  if (profile === "springer-sn" && isBackmatter(ref) && ref.slot !== "acknowledgements") {
    return { syntax: "declaration-item", text: `\\item ${heading}: \n` };
  }
  if (profile === "springer-sn" && ref.slot === "acknowledgements") {
    return { syntax: "section", text: `\\bmhead{${heading}}\n\n` };
  }
  const starred = isBackmatter(ref) ? "*" : "";
  return { syntax: "section", text: `\\section${starred}{${heading}}\n\n` };
}

export function renderFilledSlot(
  profile: TemplateProfileId,
  ref: ManuscriptSlotRef,
  body: string,
): { syntax: ManuscriptSyntax; text: string } {
  const heading = displayHeading(ref);
  if (ref.slot === "title") return { syntax: "command", text: `\\title{${body}}\n` };
  if (ref.slot === "abstract") {
    return profile === "springer-sn"
      ? { syntax: "command", text: `\\abstract{${body}}\n\n` }
      : { syntax: "environment", text: `\\begin{abstract}\n${body}\n\\end{abstract}\n\n` };
  }
  if (ref.slot === "keywords") {
    if (profile === "elsevier") return { syntax: "environment", text: `\\begin{keyword}\n${body}\n\\end{keyword}\n\n` };
    if (profile === "ieee") return { syntax: "environment", text: `\\begin{IEEEkeywords}\n${body}\n\\end{IEEEkeywords}\n\n` };
    return { syntax: "command", text: `\\keywords{${body}}\n\n` };
  }
  if (profile === "springer-sn" && isBackmatter(ref) && ref.slot !== "acknowledgements") {
    return { syntax: "declaration-item", text: `\\item ${heading}: ${body}\n` };
  }
  if (profile === "springer-sn" && ref.slot === "acknowledgements") {
    return { syntax: "section", text: `\\bmhead{${heading}}\n${body}\n\n` };
  }
  const starred = isBackmatter(ref) ? "*" : "";
  return { syntax: "section", text: `\\section${starred}{${heading}}\n${body}\n\n` };
}

export function planSlotInsertion(
  model: ManuscriptModel,
  ref: ManuscriptSlotRef,
): ManuscriptInsertion | null {
  const at = insertionAt(model, ref);
  if (at === null) return null;
  const rendered = renderEmptySlot(model.profile, ref);
  return {
    path: model.mainFile,
    at,
    text: rendered.text,
    ref,
    syntax: rendered.syntax,
  };
}
