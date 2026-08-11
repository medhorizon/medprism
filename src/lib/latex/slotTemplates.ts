import {
  displayHeading,
  isBackmatter,
  slotKey,
} from "../manuscript/slots";
import {
  renderFilledSlot,
  detectTemplateProfile,
} from "../manuscript/profiles";
import type {
  ManuscriptSlotRef,
  TemplateProfileId,
} from "../manuscript/types";
import type {
  LatexDraftFormat,
  LatexSlotTemplateSpec,
  LatexTargetKind,
  ResolvedLatexTarget,
} from "./types";

const SLOT_WRAPPER_RE =
  /\\title\s*(?:\[[^\]]*\]\s*)?\{|\\abstract\s*\{|\\keywords\s*\{|\\begin\s*\{\s*(?:abstract|keywords?|keyword|IEEEkeywords)\s*\}|\\end\s*\{\s*(?:abstract|keywords?|keyword|IEEEkeywords)\s*\}|\\section\*?\s*(?:\[[^\]]*\]\s*)?\{|\\bmhead\s*(?:\[[^\]]*\]\s*)?\{/i;

export function preferredDraftFormatForTarget(target: ResolvedLatexTarget): LatexDraftFormat {
  return /\\[A-Za-z@]+|\$|\\\(|\\\[/.test(target.existingText)
    ? "latex-body"
    : "plain-text";
}

function refForKind(kind: LatexTargetKind, heading?: string): ManuscriptSlotRef | null {
  if (kind === "selection") return null;
  if (kind === "section") return { slot: "custom-section", title: heading ?? "Section" };
  if (kind === "conflict-of-interest") return { slot: "competing-interests" };
  if (kind === "body") return { slot: "body" };
  return { slot: kind };
}

function fallbackWrapper(target: ResolvedLatexTarget): string {
  const placeholder = "<slot-body>";
  if (target.kind === "selection") return placeholder;
  if (target.kind === "body") return placeholder;
  if (target.kind === "title") return `\\title{${placeholder}}`;
  if (target.kind === "abstract") {
    return target.syntax === "command"
      ? `\\abstract{${placeholder}}`
      : `\\begin{abstract}\n${placeholder}\n\\end{abstract}`;
  }
  if (target.kind === "keywords") {
    if (target.syntax === "environment") {
      return `\\begin{keywords}\n${placeholder}\n\\end{keywords}`;
    }
    return `\\keywords{${placeholder}}`;
  }
  return `\\section${target.kind === "conflict-of-interest" ? "*" : ""}{${target.heading ?? "Section"}}\n${placeholder}`;
}

function slotRules(args: {
  ref: ManuscriptSlotRef | null;
  target: ResolvedLatexTarget;
  preferredFormat: LatexDraftFormat;
}): string[] {
  const { ref, target, preferredFormat } = args;
  const rules = [
    "Return the slot body only; omit the wrapper shown in wrapperPreview.",
    "Do not include file paths, ranges, anchors, PatchSet fields, or operation metadata.",
    `Set textDraft.format to "${preferredFormat}".`,
  ];
  if (target.kind === "selection") {
    rules.push("Replace only the selected text span; preserve any LaTeX syntax that appears inside the selected span.");
    return rules;
  }
  if (target.kind === "title") {
    rules.push("Return a single title line; do not include quotation marks, a trailing period, or \\title.");
  } else if (target.kind === "abstract") {
    rules.push("Return abstract prose only; do not include an Abstract heading, \\abstract, or an abstract environment.");
  } else if (target.kind === "keywords") {
    rules.push("Return only keyword terms; do not include a Keywords heading, \\keywords, or keyword environments.");
  } else if (ref && isBackmatter(ref)) {
    rules.push("Return the declaration statement body only; do not include a Declarations heading, section heading, \\bmhead, or \\item label.");
  } else {
    rules.push("Return section body paragraphs only; do not include \\section, \\section*, \\bmhead, bibliography, or document-level LaTeX.");
  }
  return rules;
}

export function buildLatexSlotTemplateSpec(args: {
  profile: TemplateProfileId;
  target: ResolvedLatexTarget;
  ref?: ManuscriptSlotRef;
  preferredFormat?: LatexDraftFormat;
}): LatexSlotTemplateSpec {
  const ref = args.ref ?? refForKind(args.target.kind, args.target.heading);
  const preferredFormat = args.preferredFormat ?? preferredDraftFormatForTarget(args.target);
  return {
    schemaVersion: "1",
    profile: args.profile,
    semanticSlot: ref ? slotKey(ref) : args.target.kind,
    targetKind: args.target.kind,
    heading: ref ? displayHeading(ref) : (args.target.heading ?? null),
    targetSyntax: args.target.syntax ?? "section",
    operation: args.target.mode,
    bodyContract: "slot-body-only",
    preferredFormat,
    wrapperOwnedByRuntime: true,
    wrapperPreview: ref
      ? renderFilledSlot(args.profile, ref, "<slot-body>").text.trimEnd()
      : fallbackWrapper(args.target),
    rules: slotRules({ ref, target: args.target, preferredFormat }),
  };
}

export function buildFallbackLatexSlotTemplateSpec(
  files: Readonly<Record<string, string>>,
  target: ResolvedLatexTarget,
): LatexSlotTemplateSpec {
  return buildLatexSlotTemplateSpec({
    profile: detectTemplateProfile(files),
    target,
  });
}

export function validateSlotBodyDraft(
  target: ResolvedLatexTarget,
  text: string,
): { ok: true } | { ok: false; message: string } {
  if (target.kind !== "selection" && SLOT_WRAPPER_RE.test(text)) {
    return {
      ok: false,
      message: "textDraft.text must contain slot body only, not a LaTeX wrapper or section heading",
    };
  }
  if (target.kind === "title" && /\n/.test(text.trim())) {
    return {
      ok: false,
      message: "title textDraft.text must be a single line without a LaTeX wrapper",
    };
  }
  return { ok: true };
}
