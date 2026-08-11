import type { SourceRange } from "../patch/schema";

export type ManuscriptSlotKind =
  | "title"
  | "abstract"
  | "keywords"
  | "introduction"
  | "methods"
  | "results"
  | "discussion"
  | "conclusion"
  | "acknowledgements"
  | "funding"
  | "author-contributions"
  | "competing-interests"
  | "ethics"
  | "consent-publication"
  | "data-availability"
  | "materials-availability"
  | "code-availability"
  | "supplementary-information"
  | "body";

export type ManuscriptSlotRef =
  | { slot: ManuscriptSlotKind }
  | { slot: "custom-section"; title: string };

export type TemplateProfileId =
  | "springer-sn"
  | "elsevier"
  | "acm"
  | "ieee"
  | "generic";

export type ManuscriptSyntax =
  | "command"
  | "environment"
  | "section"
  | "declaration-item"
  | "selection";

export type ManuscriptOccurrence = {
  id: string;
  ref: ManuscriptSlotRef;
  path: string;
  syntax: ManuscriptSyntax;
  heading: string;
  bodyRange: SourceRange;
  wrapperRange: SourceRange;
  body: string;
  canonical: boolean;
  duplicate: boolean;
};

export type StructuralNodeKind =
  | "begin-document"
  | "make-title"
  | "author"
  | "frontmatter-end"
  | "declarations-end"
  | "bibliography"
  | "end-document";

export type StructuralNode = {
  id: string;
  kind: StructuralNodeKind;
  path: string;
  range: SourceRange;
};

export type ManuscriptDiagnostic = {
  code: "DUPLICATE_SLOT" | "MISSING_MAIN_FILE" | "MALFORMED_STRUCTURE";
  message: string;
  occurrenceIds?: string[];
};

export type ManuscriptModel = {
  projectRevision: string;
  profile: TemplateProfileId;
  mainFile: string;
  activePaths: string[];
  files: Readonly<Record<string, string>>;
  occurrences: ManuscriptOccurrence[];
  structuralNodes: StructuralNode[];
  diagnostics: ManuscriptDiagnostic[];
};

export type ManuscriptInsertion = {
  path: string;
  at: number;
  text: string;
  ref: ManuscriptSlotRef;
  syntax: ManuscriptSyntax;
};
