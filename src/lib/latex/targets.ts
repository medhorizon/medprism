import type { ContextSnapshot } from "../context/snapshot";
import { sha256Hex } from "../patch/hash";
import type { PatchSet, SourceRange } from "../patch/schema";

export type AbstractSyntax = "command" | "environment";

export type AbstractTarget = {
  kind: "abstract";
  path: string;
  syntax: AbstractSyntax;
  mode: "replace_body" | "insert_before" | "insert_after";
  existingText: string;
  sourceContext: string;
  range?: SourceRange;
  anchor?: string;
  /** Exact opening command/environment used when an existing body is empty. */
  openingAnchor?: string;
  openingRange?: SourceRange;
};

export type ResolveAbstractTargetResult =
  | { ok: true; target: AbstractTarget }
  | { ok: false; message: string };

export type BuildAbstractPatchResult =
  | { ok: true; patchSet: PatchSet; plainText: string }
  | { ok: false; message: string };

type LocatedBody = {
  syntax: AbstractSyntax;
  commandStart: number;
  bodyStart: number;
  bodyEnd: number;
  commandEnd: number;
  openingAnchor: string;
};

function isEscaped(source: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

/** Preserve offsets while removing LaTeX comments from structural searches. */
export function maskLatexComments(source: string): string {
  const output: string[] = [];
  let inComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === "\n" || character === "\r") {
      output.push(character);
      inComment = false;
      continue;
    }
    if (inComment) {
      output.push(" ");
      continue;
    }
    if (character === "%" && !isEscaped(source, index)) {
      output.push(" ");
      inComment = true;
      continue;
    }
    output.push(character);
  }
  return output.join("");
}

function blankRangePreservingLines(source: string, start: number, end: number): string {
  return source.slice(start, end).replace(/[^\r\n]/g, " ");
}

/** Ignore documentation/examples that are not executable LaTeX structure. */
function maskVerbatimLikeRegions(source: string): string {
  let masked = source;
  const environmentPattern = /\\begin\s*\{\s*(verbatim\*?|Verbatim|lstlisting|minted)\s*\}/g;
  for (const match of source.matchAll(environmentPattern)) {
    if (match.index === undefined) continue;
    const environment = match[1]!;
    const endPattern = new RegExp(`\\\\end\\s*\\{\\s*${environment.replace("*", "\\*")}\\s*\\}`, "g");
    endPattern.lastIndex = match.index + match[0].length;
    const end = endPattern.exec(source);
    const rangeEnd = end ? end.index + end[0].length : source.length;
    masked = `${masked.slice(0, match.index)}${blankRangePreservingLines(source, match.index, rangeEnd)}${masked.slice(rangeEnd)}`;
  }

  const characters = masked.split("");
  for (let index = 0; index < masked.length; index += 1) {
    if (!masked.startsWith("\\verb", index) || isEscaped(masked, index)) continue;
    let delimiterIndex = index + "\\verb".length;
    if (masked[delimiterIndex] === "*") delimiterIndex += 1;
    const delimiter = masked[delimiterIndex];
    if (!delimiter || /[\p{L}\p{N}\s]/u.test(delimiter)) continue;
    const closingIndex = masked.indexOf(delimiter, delimiterIndex + 1);
    if (closingIndex < 0) continue;
    for (let cursor = index; cursor <= closingIndex; cursor += 1) {
      if (characters[cursor] !== "\n" && characters[cursor] !== "\r") characters[cursor] = " ";
    }
    index = closingIndex;
  }
  return characters.join("");
}

export function structuralMask(source: string): string {
  return maskVerbatimLikeRegions(maskLatexComments(source));
}

export function findMatchingBrace(masked: string, openingIndex: number): number {
  let depth = 0;
  for (let index = openingIndex; index < masked.length; index += 1) {
    const character = masked[index]!;
    if (isEscaped(masked, index)) continue;
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

function locateCommandAbstracts(source: string, masked: string): LocatedBody[] {
  const targets: LocatedBody[] = [];
  const pattern = /\\abstract\s*\{/g;
  for (const match of masked.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const openingBrace = masked.indexOf("{", match.index);
    if (openingBrace < 0) continue;
    const closingBrace = findMatchingBrace(masked, openingBrace);
    if (closingBrace < 0) continue;
    targets.push({
      syntax: "command",
      commandStart: match.index,
      bodyStart: openingBrace + 1,
      bodyEnd: closingBrace,
      commandEnd: closingBrace + 1,
      openingAnchor: source.slice(match.index, openingBrace + 1),
    });
  }
  return targets;
}

function locateEnvironmentAbstracts(source: string, masked: string): LocatedBody[] {
  const targets: LocatedBody[] = [];
  const beginPattern = /\\begin\s*\{\s*abstract\s*\}/g;
  const endPattern = /\\end\s*\{\s*abstract\s*\}/g;
  for (const begin of masked.matchAll(beginPattern)) {
    if (begin.index === undefined) continue;
    const beginEnd = begin.index + begin[0].length;
    endPattern.lastIndex = beginEnd;
    const end = endPattern.exec(masked);
    if (!end || end.index < beginEnd) continue;
    targets.push({
      syntax: "environment",
      commandStart: begin.index,
      bodyStart: beginEnd,
      bodyEnd: end.index,
      commandEnd: end.index + end[0].length,
      openingAnchor: source.slice(begin.index, beginEnd),
    });
  }
  return targets;
}

export function latexExcerpt(source: string, start: number, end: number, radius = 500): string {
  return source.slice(Math.max(0, start - radius), Math.min(source.length, end + radius));
}

function targetsInFile(path: string, source: string): AbstractTarget[] {
  const masked = structuralMask(source);
  const located = [
    ...locateCommandAbstracts(source, masked),
    ...locateEnvironmentAbstracts(source, masked),
  ].sort((left, right) => left.commandStart - right.commandStart);

  return located.map((target) => ({
    kind: "abstract",
    path,
    syntax: target.syntax,
    mode: "replace_body",
    existingText: source.slice(target.bodyStart, target.bodyEnd),
    sourceContext: latexExcerpt(source, target.commandStart, target.commandEnd),
    range: { start: target.bodyStart, end: target.bodyEnd },
    openingAnchor: target.openingAnchor,
    openingRange: { start: target.commandStart, end: target.bodyStart },
  }));
}

function uniqueActiveAnchor(
  source: string,
  pattern: RegExp,
): { text: string; range: SourceRange } | null {
  const masked = structuralMask(source);
  const matches = [...masked.matchAll(pattern)];
  if (matches.length !== 1) return null;
  const start = matches[0]!.index!;
  const end = start + matches[0]![0].length;
  return { text: source.slice(start, end), range: { start, end } };
}

function preferredTexPaths(snapshot: ContextSnapshot): string[] {
  const ordered = [snapshot.mainFile, snapshot.activeFile]
    .filter((path): path is string => Boolean(path));
  for (const path of Object.keys(snapshot.files).sort()) {
    if (path.toLowerCase().endsWith(".tex")) ordered.push(path);
  }
  return [...new Set(ordered)];
}

function insertionSyntax(source: string): AbstractSyntax {
  const masked = structuralMask(source);
  return /\\documentclass(?:\s*\[[^\]]*\])?\s*\{\s*sn-jnl\s*\}/i.test(masked)
    ? "command"
    : "environment";
}

function requiresAbstractBeforeMakeTitle(source: string): boolean {
  const masked = structuralMask(source);
  return /\\documentclass(?:\s*\[[^\]]*\])?\s*\{\s*(?:sn-jnl|acmart)\s*\}/i.test(masked);
}

/** Locate an existing Abstract, or a single safe insertion point in the main LaTeX file. */
export function resolveAbstractTarget(snapshot: ContextSnapshot): ResolveAbstractTargetResult {
  const paths = preferredTexPaths(snapshot);
  for (const path of paths) {
    const source = snapshot.files[path];
    if (source === undefined || !path.toLowerCase().endsWith(".tex")) continue;
    const targets = targetsInFile(path, source);
    if (targets.length === 1) return { ok: true, target: targets[0]! };
    if (targets.length > 1) {
      return {
        ok: false,
        message: `Multiple active abstract targets were found in ${path}; select the intended source before applying an edit.`,
      };
    }
  }

  const insertionCandidates = [snapshot.mainFile, snapshot.activeFile, ...paths]
    .filter((path): path is string => Boolean(path));
  const insertionPath = [...new Set(insertionCandidates)].find(
    (path) => path.toLowerCase().endsWith(".tex") && snapshot.files[path] !== undefined,
  );
  if (!insertionPath) return { ok: false, message: "No LaTeX file is available for an abstract." };
  const source = snapshot.files[insertionPath]!;
  const syntax = insertionSyntax(source);
  const makeTitle = uniqueActiveAnchor(source, /\\maketitle\b/g);
  if (makeTitle) {
    const mode = requiresAbstractBeforeMakeTitle(source)
      ? "insert_before" as const
      : "insert_after" as const;
    return {
      ok: true,
      target: {
        kind: "abstract",
        path: insertionPath,
        syntax,
        mode,
        anchor: makeTitle.text,
        range: makeTitle.range,
        existingText: "",
        sourceContext: latexExcerpt(source, makeTitle.range.start, makeTitle.range.end),
      },
    };
  }

  const beginDocument = uniqueActiveAnchor(source, /\\begin\s*\{\s*document\s*\}/g);
  if (beginDocument) {
    return {
      ok: true,
      target: {
        kind: "abstract",
        path: insertionPath,
        syntax,
        mode: "insert_after",
        anchor: beginDocument.text,
        range: beginDocument.range,
        existingText: "",
        sourceContext: latexExcerpt(
          source,
          beginDocument.range.start,
          beginDocument.range.end,
        ),
      },
    };
  }

  return {
    ok: false,
    message: `No existing abstract, unique \\maketitle, or unique \\begin{document} anchor was found in ${insertionPath}.`,
  };
}

export function normalizeAbstractDraft(text: string): string {
  const withoutHeading = text
    .trim()
    .replace(/^\*{0,2}\s*abstract\s*\*{0,2}\s*[:：-]?\s*/i, "")
    .replace(/^摘要\s*[:：-]?\s*/i, "");
  return withoutHeading.replace(/\s+/g, " ").trim();
}

export function escapeLatexPlainText(text: string): string {
  const replacements: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    "#": "\\#",
    "$": "\\$",
    "%": "\\%",
    "&": "\\&",
    "_": "\\_",
    "^": "\\textasciicircum{}",
    "~": "\\textasciitilde{}",
  };
  return [...text].map((character) => replacements[character] ?? character).join("");
}

function renderAbstractBlock(syntax: AbstractSyntax, escapedText: string): string {
  return syntax === "command"
    ? `\\abstract{${escapedText}}\n\n`
    : `\\begin{abstract}\n${escapedText}\n\\end{abstract}\n\n`;
}

export async function buildAbstractPatch(
  snapshot: ContextSnapshot,
  target: AbstractTarget,
  draftText: string,
): Promise<BuildAbstractPatchResult> {
  const plainText = normalizeAbstractDraft(draftText);
  if (!plainText) return { ok: false, message: "The generated abstract is empty." };
  if (plainText.length > 8_000) {
    return { ok: false, message: "The generated abstract exceeds the safe draft length." };
  }
  const source = snapshot.files[target.path];
  if (source === undefined) {
    return { ok: false, message: `Abstract target file is missing: ${target.path}` };
  }
  const escapedText = escapeLatexPlainText(plainText);
  const baseSha256 = await sha256Hex(source);
  let operation: PatchSet["operations"][number];

  if (target.mode === "replace_body" && target.range) {
    if (target.existingText.length > 0) {
      operation = {
        op: "replace_text",
        path: target.path,
        baseSha256,
        oldText: target.existingText,
        newText: target.syntax === "environment" ? `\n${escapedText}\n` : escapedText,
        expectedOccurrences: 1,
        range: target.range,
      };
    } else if (target.openingAnchor && target.openingRange) {
      operation = {
        op: "replace_text",
        path: target.path,
        baseSha256,
        oldText: target.openingAnchor,
        newText: `${target.openingAnchor}${target.syntax === "environment" ? `\n${escapedText}\n` : escapedText}`,
        expectedOccurrences: 1,
        range: target.openingRange,
      };
    } else {
      return { ok: false, message: "The empty abstract target has no safe opening anchor." };
    }
  } else if (target.mode === "insert_before" && target.anchor && target.range) {
    operation = {
      op: "replace_text",
      path: target.path,
      baseSha256,
      oldText: target.anchor,
      newText: `${renderAbstractBlock(target.syntax, escapedText)}${target.anchor}`,
      expectedOccurrences: 1,
      range: target.range,
    };
  } else if (target.mode === "insert_after" && target.anchor && target.range) {
    operation = {
      op: "replace_text",
      path: target.path,
      baseSha256,
      oldText: target.anchor,
      newText: `${target.anchor}\n\n${renderAbstractBlock(target.syntax, escapedText)}`,
      expectedOccurrences: 1,
      range: target.range,
    };
  } else {
    return { ok: false, message: "The abstract target is incomplete." };
  }

  return {
    ok: true,
    plainText,
    patchSet: {
      schemaVersion: "1",
      id: crypto.randomUUID(),
      projectRevision: snapshot.projectRevision,
      summary: "Write the drafted abstract into the LaTeX document",
      operations: [operation],
      verify: { compile: true },
    },
  };
}
