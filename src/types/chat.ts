import type {
  FileSnapshot,
  PatchPreview,
  PatchSet,
  PatchValidationError,
} from "../lib/patch/schema";

export type ChatRole = "user" | "assistant";
export type SuggestionStatus = "pending" | "applied" | "undone" | "dismissed";

export type ChatSuggestion = {
  title: string;
  /** Legacy suggestion body, display-only. */
  body: string;
  path?: string | undefined;
  status?: SuggestionStatus | undefined;
  appliedTo?: string | undefined;
  patchSet?: PatchSet | undefined;
  patchError?: PatchValidationError | undefined;
  previews?: PatchPreview[] | undefined;
  previousFiles?: Record<string, FileSnapshot> | undefined;
  postApplyHashes?: Record<string, string> | undefined;
  appliedProjectRevision?: string | undefined;
  legacyDisplayOnly?: boolean | undefined;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  suggestion?: ChatSuggestion | undefined;
};

export type ProjectFile = {
  id: string;
  name: string;
  kind: "tex" | "bib" | "asset" | "cls";
};
