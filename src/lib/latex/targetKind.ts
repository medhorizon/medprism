import type { LatexTargetKind } from "./types";

const TARGET_KINDS = new Set<LatexTargetKind>([
  "selection",
  "abstract",
  "title",
  "keywords",
  "introduction",
  "methods",
  "results",
  "discussion",
  "conclusion",
  "funding",
  "acknowledgements",
  "author-contributions",
  "data-availability",
  "ethics",
  "conflict-of-interest",
  "body",
  "section",
]);

export function parseTargetKind(value: unknown): LatexTargetKind | undefined {
  if (typeof value !== "string") return undefined;
  const kind = value.trim() as LatexTargetKind;
  return TARGET_KINDS.has(kind) ? kind : undefined;
}
