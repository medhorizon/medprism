import type { ContextSnapshot } from "../context/snapshot";
import { sha256Hex } from "../patch/hash";
import type { PatchSet, SourceRange } from "../patch/schema";
import { assertSafeProjectRelativePath } from "../projectPath";
import {
  escapeLatexPlainText,
  latexExcerpt,
  locateLatexCommands,
  resolveAbstractTarget,
  structuralMask,
} from "./targets";
import type {
  LatexDraftFormat,
  LatexTargetKind,
  LatexTargetSpec,
  ResolvedLatexTarget,
} from "./types";

export type ResolveLatexTargetResult =
  | { ok: true; target: ResolvedLatexTarget }
  | { ok: false; message: string };

export type BuildLatexTextPatchResult =
  | { ok: true; patchSet: PatchSet; renderedText: string; plainText: string }
  | { ok: false; message: string };

type LocatedSection = {
  path: string;
  title: string;
  headingStart: number;
  headingEnd: number;
  bodyStart: number;
  bodyEnd: number;
};

const TARGET_ALIASES: Partial<Record<LatexTargetKind, string[]>> = {
  introduction: ["introduction", "background", "引言", "绪论", "背景"],
  methods: [
    "methods",
    "method",
    "methodology",
    "materials and methods",
    "patients and methods",
    "方法",
    "材料与方法",
    "患者与方法",
    "方法学",
  ],
  results: ["results", "result", "结果"],
  discussion: ["discussion", "讨论"],
  conclusion: ["conclusion", "conclusions", "结论", "结语"],
  funding: ["funding", "financial support", "funding information", "基金", "资助"],
  acknowledgements: [
    "acknowledgements",
    "acknowledgments",
    "acknowledgement",
    "acknowledgment",
    "致谢",
  ],
  "author-contributions": ["author contributions", "authors contributions", "作者贡献", "作者分工"],
  "data-availability": ["data availability", "availability of data", "数据可用性", "数据共享"],
  ethics: ["ethics approval", "ethical approval", "ethics statement", "伦理声明", "伦理审批"],
  "conflict-of-interest": [
    "conflict of interest",
    "conflicts of interest",
    "competing interests",
    "利益冲突",
    "竞争性利益",
  ],
};

const BACKMATTER_KINDS = new Set<LatexTargetKind>([
  "funding",
  "acknowledgements",
  "author-contributions",
  "data-availability",
  "ethics",
  "conflict-of-interest",
]);

function preferredTexPaths(snapshot: ContextSnapshot, explicit?: string): string[] {
  const ordered: string[] = [];
  if (explicit) ordered.push(assertSafeProjectRelativePath(explicit));
  if (snapshot.mainFile) ordered.push(snapshot.mainFile);
  ordered.push(snapshot.activeFile);
  for (const path of Object.keys(snapshot.files).sort()) {
    if (path.toLowerCase().endsWith(".tex")) ordered.push(path);
  }
  return [...new Set(ordered)].filter(
    (path) => path.toLowerCase().endsWith(".tex") && snapshot.files[path] !== undefined,
  );
}

function normalizeHeading(value: string): string {
  return value
    .replace(/\\[A-Za-z@]+\*?(?:\[[^\]]*\])?/g, " ")
    .replace(/[{}~*_]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function headingMatches(kind: LatexTargetKind, title: string, spec: LatexTargetSpec): boolean {
  if (kind === "section") {
    return Boolean(spec.sectionTitle) && normalizeHeading(title) === normalizeHeading(spec.sectionTitle ?? "");
  }
  return (TARGET_ALIASES[kind] ?? []).some(
    (alias) => normalizeHeading(title) === normalizeHeading(alias),
  );
}

function locateCommandBodies(
  path: string,
  source: string,
  commandName: "title" | "keywords",
): ResolvedLatexTarget[] {
  const masked = structuralMask(source);
  return locateLatexCommands(source, masked, commandName).map((command) => ({
    kind: commandName,
    path,
    mode: "replace_body" as const,
    syntax: "command" as const,
    commandName,
    existingText: source.slice(command.bodyStart, command.bodyEnd),
    sourceContext: latexExcerpt(source, command.commandStart, command.commandEnd),
    range: { start: command.bodyStart, end: command.bodyEnd },
    openingAnchor: command.openingAnchor,
    openingRange: { start: command.commandStart, end: command.bodyStart },
    ...(command.optionalArg !== undefined ? { optionalArg: command.optionalArg } : {}),
    ...(command.optionalArgRange ? { optionalArgRange: command.optionalArgRange } : {}),
  }));
}

function locateKeywordEnvironments(path: string, source: string): ResolvedLatexTarget[] {
  const masked = structuralMask(source);
  const beginPattern = /\\begin\s*\{\s*keywords?\s*\}/gi;
  const targets: ResolvedLatexTarget[] = [];
  for (const begin of masked.matchAll(beginPattern)) {
    if (begin.index === undefined) continue;
    const beginEnd = begin.index + begin[0].length;
    const endPattern = /\\end\s*\{\s*keywords?\s*\}/gi;
    endPattern.lastIndex = beginEnd;
    const end = endPattern.exec(masked);
    if (!end) continue;
    targets.push({
      kind: "keywords",
      path,
      mode: "replace_body",
      syntax: "environment",
      commandName: "keywords",
      existingText: source.slice(beginEnd, end.index),
      sourceContext: latexExcerpt(source, begin.index, end.index + end[0].length),
      range: { start: beginEnd, end: end.index },
      openingAnchor: source.slice(begin.index, beginEnd),
      openingRange: { start: begin.index, end: beginEnd },
    });
  }
  return targets;
}

function locateSections(path: string, source: string): LocatedSection[] {
  const masked = structuralMask(source);
  const commands = [
    ...locateLatexCommands(source, masked, "section", { allowStar: true }),
    ...locateLatexCommands(source, masked, "bmhead"),
  ].sort((left, right) => left.commandStart - right.commandStart);
  const endDocument = masked.search(/\\end\s*\{\s*document\s*\}/);
  return commands.map((command, index) => ({
    path,
    title: source.slice(command.bodyStart, command.bodyEnd),
    headingStart: command.commandStart,
    headingEnd: command.commandEnd,
    bodyStart: command.commandEnd,
    bodyEnd: commands[index + 1]?.commandStart ?? (endDocument >= 0 ? endDocument : source.length),
  }));
}

function sectionTarget(
  source: string,
  section: LocatedSection,
  spec: LatexTargetSpec,
): ResolvedLatexTarget {
  return {
    kind: spec.kind,
    path: section.path,
    mode: "replace_body",
    syntax: "section",
    heading: section.title,
    existingText: source.slice(section.bodyStart, section.bodyEnd),
    sourceContext: latexExcerpt(source, section.headingStart, section.bodyEnd),
    range: { start: section.bodyStart, end: section.bodyEnd },
  };
}

function firstMatchRange(source: string, patterns: readonly RegExp[]): { text: string; range: SourceRange } | null {
  const masked = structuralMask(source);
  let best: { text: string; range: SourceRange } | null = null;
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const matcher = new RegExp(pattern.source, flags);
    const match = matcher.exec(masked);
    if (!match || match.index < 0) continue;
    const candidate = {
      text: source.slice(match.index, match.index + match[0].length),
      range: { start: match.index, end: match.index + match[0].length },
    };
    if (!best || candidate.range.start < best.range.start) best = candidate;
  }
  return best;
}

function sectionPatterns(kinds: readonly LatexTargetKind[]): RegExp[] {
  const aliases = kinds.flatMap((kind) => TARGET_ALIASES[kind] ?? []);
  return aliases.map((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    // Allow optional short-title args: \section[short]{Introduction}
    return new RegExp(
      `\\\\(?:section\\*?|bmhead)\\s*(?:\\[[^\\]]*\\]\\s*)?\\{\\s*${escaped}\\s*\\}`,
      "i",
    );
  });
}

/** Public helper for patch hydrate: place a named structural block correctly. */
export function trustedInsertPlacement(
  source: string,
  kind: LatexTargetKind,
): { mode: "insert_before" | "insert_after"; anchor: string } | null {
  const anchor = safeInsertionAnchor(source, kind);
  if (!anchor) return null;
  return { mode: anchor.mode, anchor: anchor.text };
}

/** Infer a structural target from draft LaTeX (heading / command), not from file offsets. */
export function inferLatexTargetKindFromDraft(text: string): LatexTargetKind | null {
  if (/\\keywords\b/i.test(text) || /\\kwd\b/i.test(text)) return "keywords";
  if (/\\begin\s*\{\s*abstract\s*\}/i.test(text) || /\\abstract\s*\{/i.test(text)) {
    return "abstract";
  }
  if (/\\title\b/i.test(text)) return "title";

  const headingMatch = text.match(
    /\\(?:section\*?|subsection\*?|bmhead)\s*(?:\[[^\]]*\]\s*)?\{([^}]+)\}/i,
  );
  // Only headings count. Figure paths like result.png must not infer "results".
  const haystack = headingMatch?.[1] ? normalizeHeading(headingMatch[1]) : "";
  if (!haystack) return null;

  let best: { kind: LatexTargetKind; score: number } | null = null;
  for (const [kind, aliases] of Object.entries(TARGET_ALIASES) as Array<
    [LatexTargetKind, string[]]
  >) {
    for (const alias of aliases) {
      const needle = normalizeHeading(alias);
      if (!needle) continue;
      if (haystack === needle) return kind;
      if (needle.length >= 5 && haystack.includes(needle)) {
        const score = needle.length;
        if (!best || score > best.score) best = { kind, score };
      }
    }
  }
  return best?.kind ?? null;
}

function safeInsertionAnchor(
  source: string,
  kind: LatexTargetKind,
): { mode: "insert_before" | "insert_after"; text: string; range: SourceRange } | null {
  const bibliography = [
    /\\bibliography\s*\{[^}]+\}/i,
    /\\printbibliography\b/i,
    /\\begin\s*\{\s*thebibliography\s*\}/i,
  ];
  const endDocument = [/\\end\s*\{\s*document\s*\}/i];
  const backmatter = [
    ...sectionPatterns([
      "funding",
      "acknowledgements",
      "author-contributions",
      "data-availability",
      "ethics",
      "conflict-of-interest",
    ]),
    ...bibliography,
    ...endDocument,
  ];

  if (kind === "introduction") {
    const firstSection = firstMatchRange(source, [/\\(?:section\*?|bmhead)\s*\{[^}]+\}/i]);
    if (firstSection) return { mode: "insert_before", ...firstSection };
    const afterTitle = firstMatchRange(source, [/\\maketitle\b/i, /\\begin\s*\{\s*document\s*\}/i]);
    return afterTitle ? { mode: "insert_after", ...afterTitle } : null;
  }

  const laterKinds: Partial<Record<LatexTargetKind, LatexTargetKind[]>> = {
    methods: ["results", "discussion", "conclusion"],
    results: ["discussion", "conclusion"],
    discussion: ["conclusion"],
    conclusion: [],
  };
  if (kind in laterKinds) {
    const anchor = firstMatchRange(source, [
      ...sectionPatterns(laterKinds[kind] ?? []),
      ...backmatter,
    ]);
    return anchor ? { mode: "insert_before", ...anchor } : null;
  }

  if (BACKMATTER_KINDS.has(kind) || kind === "body" || kind === "section") {
    const anchor = firstMatchRange(source, [...bibliography, ...endDocument]);
    return anchor ? { mode: "insert_before", ...anchor } : null;
  }

  if (kind === "keywords") {
    // Journal templates (e.g. sn-jnl) place keywords after abstract and before \maketitle.
    // Prefer a unique full command match so range-less validation stays safe.
    const beforeMaketitle = firstMatchRange(source, [
      /\\maketitle\b/i,
      /\\(?:section\*?|bmhead)\s*(?:\[[^\]]*\]\s*)?\{[^}]*\}/i,
    ]);
    if (beforeMaketitle) return { mode: "insert_before", ...beforeMaketitle };
    const masked = structuralMask(source);
    const abstractCommand = locateLatexCommands(source, masked, "abstract")[0];
    if (abstractCommand) {
      return {
        mode: "insert_after",
        text: source.slice(abstractCommand.commandStart, abstractCommand.commandEnd),
        range: { start: abstractCommand.commandStart, end: abstractCommand.commandEnd },
      };
    }
    const endAbstract = firstMatchRange(source, [/\\end\s*\{\s*abstract\s*\}/i]);
    return endAbstract ? { mode: "insert_after", ...endAbstract } : null;
  }

  if (kind === "title") {
    // Prefer inside the document body (Springer sn-jnl / many journal classes).
    const frontMatter = firstMatchRange(source, [
      /\\author\*?(?![A-Za-z@])/i,
      /\\maketitle\b/i,
      /\\(?:section\*?|bmhead)\s*(?:\[[^\]]*\]\s*)?\{/i,
    ]);
    const beginDocument = firstMatchRange(source, [/\\begin\s*\{\s*document\s*\}/i]);
    if (
      beginDocument &&
      frontMatter &&
      frontMatter.range.start >= beginDocument.range.end
    ) {
      return { mode: "insert_before", ...frontMatter };
    }
    if (beginDocument) return { mode: "insert_after", ...beginDocument };
    return null;
  }
  return null;
}

/** Short running-head title derived from the full title body. */
function shortTitleFrom(fullTitle: string): string {
  const compact = fullTitle.replace(/\s+/g, " ").trim();
  const clause = compact.split(/[:.?!—–]/u)[0]?.trim() || compact;
  if (clause.length <= 60) return clause;
  const sliced = clause.slice(0, 57).replace(/\s+\S*$/, "").trim();
  return `${sliced || clause.slice(0, 57)}...`;
}

function displayHeading(spec: LatexTargetSpec): string {
  const titles: Partial<Record<LatexTargetKind, string>> = {
    introduction: "Introduction",
    methods: "Methods",
    results: "Results",
    discussion: "Discussion",
    conclusion: "Conclusion",
    funding: "Funding",
    acknowledgements: "Acknowledgements",
    "author-contributions": "Author contributions",
    "data-availability": "Data availability",
    ethics: "Ethics approval",
    "conflict-of-interest": "Competing interests",
  };
  return spec.kind === "section"
    ? (spec.sectionTitle?.trim() || "Section")
    : (titles[spec.kind] ?? "");
}

function isSpringerNature(source: string): boolean {
  return /\\documentclass(?:\s*\[[^\]]*\])?\s*\{\s*sn-jnl\s*\}/i.test(structuralMask(source));
}

function insertionTarget(
  snapshot: ContextSnapshot,
  spec: LatexTargetSpec,
): ResolveLatexTargetResult {
  if (spec.createIfMissing === false) {
    return { ok: false, message: `No existing ${spec.kind} LaTeX target was found.` };
  }
  const paths = preferredTexPaths(snapshot, spec.path);
  const path = paths[0];
  if (!path) return { ok: false, message: "No LaTeX source file is available." };
  const source = snapshot.files[path]!;
  const anchor = safeInsertionAnchor(source, spec.kind);
  if (!anchor) {
    return {
      ok: false,
      message: `No safe insertion anchor was found for ${spec.kind} in ${path}.`,
    };
  }
  return {
    ok: true,
    target: {
      kind: spec.kind,
      path,
      mode: anchor.mode,
      syntax: spec.kind === "title" || spec.kind === "keywords"
        ? "command"
        : spec.kind === "body"
          ? "body"
          : "section",
      existingText: "",
      sourceContext: latexExcerpt(source, anchor.range.start, anchor.range.end),
      anchor: anchor.text,
      range: anchor.range,
      ...(spec.kind !== "title" && spec.kind !== "keywords" && spec.kind !== "body"
        ? { heading: displayHeading(spec) }
        : {}),
      ...(spec.kind === "title" || spec.kind === "keywords"
        ? { commandName: spec.kind }
        : {}),
    },
  };
}

/** Resolve a runtime-owned target without asking the model to guess paths or anchors. */
export function resolveLatexTarget(
  snapshot: ContextSnapshot,
  spec: LatexTargetSpec,
): ResolveLatexTargetResult {
  if (spec.kind === "selection") {
    if (!snapshot.selection || snapshot.selectedText === undefined) {
      return { ok: false, message: "This text action requires an active editor selection." };
    }
    if (spec.path && assertSafeProjectRelativePath(spec.path) !== snapshot.activeFile) {
      return { ok: false, message: "The requested selection target is not in the active file." };
    }
    return {
      ok: true,
      target: {
        kind: "selection",
        path: snapshot.activeFile,
        mode: "replace_body",
        syntax: "selection",
        existingText: snapshot.selectedText,
        sourceContext: snapshot.localContext,
        range: { ...snapshot.selection },
      },
    };
  }

  if (spec.kind === "abstract") {
    const resolved = resolveAbstractTarget(snapshot);
    if (!resolved.ok) return resolved;
    if (spec.path && assertSafeProjectRelativePath(spec.path) !== resolved.target.path) {
      return { ok: false, message: `The Abstract was found in ${resolved.target.path}, not ${spec.path}.` };
    }
    return {
      ok: true,
      target: {
        kind: "abstract",
        path: resolved.target.path,
        mode: resolved.target.mode,
        syntax: resolved.target.syntax,
        existingText: resolved.target.existingText,
        sourceContext: resolved.target.sourceContext,
        ...(resolved.target.range ? { range: resolved.target.range } : {}),
        ...(resolved.target.anchor ? { anchor: resolved.target.anchor } : {}),
        ...(resolved.target.openingAnchor ? { openingAnchor: resolved.target.openingAnchor } : {}),
        ...(resolved.target.openingRange ? { openingRange: resolved.target.openingRange } : {}),
      },
    };
  }

  const paths = preferredTexPaths(snapshot, spec.path);
  const matches: ResolvedLatexTarget[] = [];
  for (const path of paths) {
    const source = snapshot.files[path]!;
    if (spec.kind === "title") matches.push(...locateCommandBodies(path, source, "title"));
    if (spec.kind === "keywords") {
      matches.push(...locateCommandBodies(path, source, "keywords"));
      matches.push(...locateKeywordEnvironments(path, source));
    }
    if (
      spec.kind !== "title" &&
      spec.kind !== "keywords" &&
      spec.kind !== "body"
    ) {
      for (const section of locateSections(path, source)) {
        if (headingMatches(spec.kind, section.title, spec)) {
          matches.push(sectionTarget(source, section, spec));
        }
      }
    }
  }

  if (matches.length === 1) return { ok: true, target: matches[0]! };
  if (matches.length > 1) {
    const preferred = preferCanonicalTargets(snapshot, matches);
    if (preferred.length === 1) return { ok: true, target: preferred[0]! };
    return {
      ok: false,
      message: `Multiple ${spec.kind} targets were found; select or specify the intended file.`,
    };
  }
  return insertionTarget(snapshot, spec);
}

/**
 * When duplicate structural targets exist (e.g. a stale preamble \\title plus the
 * real journal \\title after \\begin{document}), prefer the in-document one.
 */
function preferCanonicalTargets(
  snapshot: ContextSnapshot,
  matches: ResolvedLatexTarget[],
): ResolvedLatexTarget[] {
  const scored = matches.map((target) => {
    const source = snapshot.files[target.path] ?? "";
    const masked = structuralMask(source);
    const beginDocument = masked.search(/\\begin\s*\{\s*document\s*\}/);
    const maketitle = masked.search(/\\maketitle\b/);
    const start = target.range?.start ?? target.openingRange?.start ?? target.sourceContext.length;
    let score = 0;
    if (beginDocument >= 0 && start >= beginDocument) score += 100;
    if (maketitle >= 0 && start <= maketitle) score += 20;
    if (target.optionalArg !== undefined) score += 10;
    if (target.path === snapshot.mainFile) score += 5;
    if (target.path === snapshot.activeFile) score += 2;
    return { target, score, start };
  });
  scored.sort((left, right) => right.score - left.score || left.start - right.start);
  const best = scored[0]!.score;
  return scored.filter((entry) => entry.score === best).map((entry) => entry.target);
}

function normalizePlainDraft(text: string): string {
  return text
    .replace(/\r\n?|\r/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/[ \t\n]+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function validateLatexBody(text: string): { ok: true } | { ok: false; message: string } {
  if (
    /\\(?:documentclass|usepackage|begin\s*\{\s*document\s*\}|end\s*\{\s*document\s*\}|input|include|write18|bibliography|addbibresource)\b/i.test(text)
  ) {
    return { ok: false, message: "The drafted LaTeX body contains project-level commands." };
  }
  if (/```/.test(text)) return { ok: false, message: "The drafted text must not contain code fences." };
  return { ok: true };
}

function renderSectionHeading(source: string, target: ResolvedLatexTarget): string {
  const heading = target.heading ?? "Section";
  if (BACKMATTER_KINDS.has(target.kind)) {
    return isSpringerNature(source)
      ? `\\bmhead{${heading}}`
      : `\\section*{${heading}}`;
  }
  return `\\section{${heading}}`;
}

function renderInsertedBlock(
  source: string,
  target: ResolvedLatexTarget,
  renderedText: string,
): string {
  if (target.kind === "abstract") {
    return target.syntax === "command"
      ? `\\abstract{${renderedText}}\n\n`
      : `\\begin{abstract}\n${renderedText}\n\\end{abstract}\n\n`;
  }
  if (target.kind === "title") return `\\title{${renderedText}}\n`;
  if (target.kind === "keywords") return `\\keywords{${renderedText}}\n`;
  if (target.kind === "body") return `${renderedText}\n\n`;
  return `${renderSectionHeading(source, target)}\n${renderedText}\n\n`;
}

/** Convert a model-owned text draft into one runtime-owned, compile-verified PatchSet. */
export async function buildLatexTextPatch(args: {
  snapshot: ContextSnapshot;
  target: ResolvedLatexTarget;
  text: string;
  format: LatexDraftFormat;
  summary?: string;
}): Promise<BuildLatexTextPatchResult> {
  const normalized = args.format === "plain-text"
    ? normalizePlainDraft(args.text)
    : args.text.replace(/\r\n?|\r/g, "\n").trim();
  const inserting =
    args.target.mode === "insert_before" || args.target.mode === "insert_after";
  // Runtime scaffolds may insert empty section shells; replacements still need prose.
  if (!normalized && !inserting) {
    return { ok: false, message: "The generated text is empty." };
  }
  if (normalized.length > 80_000) {
    return { ok: false, message: "The generated text exceeds the safe draft length." };
  }
  if (args.format === "latex-body") {
    const safe = validateLatexBody(normalized);
    if (!safe.ok) return safe;
  }
  if (
    args.target.existingText.length > 0 &&
    args.format === "plain-text" &&
    /\\[A-Za-z@]+|\$|\\\(|\\\[/.test(args.target.existingText)
  ) {
    return {
      ok: false,
      message: "A target containing LaTeX commands or mathematics must be returned as latex-body so structure is preserved.",
    };
  }

  const renderedText = args.format === "plain-text"
    ? escapeLatexPlainText(normalized)
    : normalized;
  const source = args.snapshot.files[args.target.path];
  if (source === undefined) {
    return { ok: false, message: `LaTeX target file is missing: ${args.target.path}` };
  }
  const baseSha256 = await sha256Hex(source);
  let operation: PatchSet["operations"][number];

  if (args.target.mode === "replace_body" && args.target.range) {
    if (args.target.existingText.length > 0) {
      // When `\title[Same]{Same}` (common journal placeholder), update both args together
      // so running heads do not keep the stale short title.
      if (
        args.target.kind === "title" &&
        args.target.optionalArg !== undefined &&
        args.target.optionalArgRange &&
        args.target.optionalArg === args.target.existingText
      ) {
        const short = shortTitleFrom(renderedText);
        const spanStart = args.target.optionalArgRange.start - 1;
        const spanEnd = args.target.range.end + 1;
        operation = {
          op: "replace_text",
          path: args.target.path,
          baseSha256,
          oldText: source.slice(spanStart, spanEnd),
          newText: `[${short}]{${renderedText}}`,
          expectedOccurrences: 1,
          range: { start: spanStart, end: spanEnd },
        };
      } else {
        const newText = args.target.syntax === "environment"
          ? `\n${renderedText}\n`
          : args.target.syntax === "section"
            ? `\n${renderedText}\n\n`
            : renderedText;
        operation = {
          op: "replace_text",
          path: args.target.path,
          baseSha256,
          oldText: args.target.existingText,
          newText,
          expectedOccurrences: 1,
          range: args.target.range,
        };
      }
    } else if (args.target.openingAnchor && args.target.openingRange) {
      operation = {
        op: "replace_text",
        path: args.target.path,
        baseSha256,
        oldText: args.target.openingAnchor,
        newText: `${args.target.openingAnchor}${args.target.syntax === "environment" ? `\n${renderedText}\n` : renderedText}`,
        expectedOccurrences: 1,
        range: args.target.openingRange,
      };
    } else {
      return { ok: false, message: "The empty LaTeX target has no safe opening anchor." };
    }
  } else if (
    (args.target.mode === "insert_before" || args.target.mode === "insert_after") &&
    args.target.anchor &&
    args.target.range
  ) {
    const block = renderInsertedBlock(source, args.target, renderedText);
    operation = {
      op: "replace_text",
      path: args.target.path,
      baseSha256,
      oldText: args.target.anchor,
      newText: args.target.mode === "insert_before"
        ? `${block}${args.target.anchor}`
        : `${args.target.anchor}\n\n${block}`,
      expectedOccurrences: 1,
      range: args.target.range,
    };
  } else {
    return { ok: false, message: "The resolved LaTeX target is incomplete." };
  }

  return {
    ok: true,
    plainText: normalized,
    renderedText,
    patchSet: {
      schemaVersion: "1",
      id: crypto.randomUUID(),
      projectRevision: args.snapshot.projectRevision,
      summary: args.summary ?? `Write ${args.target.kind} text into ${args.target.path}`,
      operations: [operation],
      verify: { compile: true },
    },
  };
}
