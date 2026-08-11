import type { SourceRange } from "../patch/schema";
import type { TemplateProfileId } from "../manuscript/types";

export type LatexTargetKind =
  | "selection"
  | "abstract"
  | "title"
  | "keywords"
  | "introduction"
  | "methods"
  | "results"
  | "discussion"
  | "conclusion"
  | "funding"
  | "acknowledgements"
  | "author-contributions"
  | "data-availability"
  | "ethics"
  | "conflict-of-interest"
  | "body"
  | "section";

/** A runtime-owned destination for a text-producing workflow. */
export type LatexTargetSpec = {
  kind: LatexTargetKind;
  /** Required only for a custom named section. */
  sectionTitle?: string;
  /** Optional explicit project-relative file path. */
  path?: string;
  /** Whether trusted runtime code may create the structure when it is missing. */
  createIfMissing?: boolean;
};

/** Plain prose is escaped by runtime; latex-body is preserved after validation. */
export type LatexDraftFormat = "plain-text" | "latex-body";

export type LatexSlotTemplateSpec = {
  schemaVersion: "1";
  profile: TemplateProfileId;
  semanticSlot: string;
  targetKind: LatexTargetKind;
  heading: string | null;
  targetSyntax: "command" | "environment" | "section" | "selection" | "body";
  operation: "replace_body" | "insert_before" | "insert_after";
  bodyContract: "slot-body-only";
  preferredFormat: LatexDraftFormat;
  wrapperOwnedByRuntime: true;
  wrapperPreview: string;
  rules: string[];
};

export type ResolvedLatexTarget = {
  kind: LatexTargetKind;
  path: string;
  mode: "replace_body" | "insert_before" | "insert_after";
  existingText: string;
  sourceContext: string;
  range?: SourceRange;
  anchor?: string;
  heading?: string;
  commandName?: "title" | "keywords";
  syntax?: "command" | "environment" | "section" | "selection" | "body";
  openingAnchor?: string;
  openingRange?: SourceRange;
  /** Optional short-argument text from `\command[short]{body}`. */
  optionalArg?: string;
  optionalArgRange?: SourceRange;
  slotTemplate?: LatexSlotTemplateSpec;
};
