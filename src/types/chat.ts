import type { PatchPreview, PatchSet, PatchValidationError } from "../lib/patch/schema";

export type ChatRole = "user" | "assistant";

export type SuggestionStatus = "pending" | "applied" | "undone" | "dismissed";

export type ChatSuggestion = {
  title: string;
  /**
   * Legacy fence body — display only. Never Keep-applied to `.tex`.
   * Prefer `patchSet` for editable suggestions.
   */
  body: string;
  /** Explicit project-relative path (legacy / display) */
  path?: string;
  status?: SuggestionStatus;
  /** Primary target after Keep (first affected path) */
  appliedTo?: string;
  /** @deprecated single-file undo; use previousFiles */
  previousContent?: string;
  /** Typed patch (Keep-eligible when valid) */
  patchSet?: PatchSet;
  /** Structured validation failure — Keep disabled */
  patchError?: PatchValidationError;
  /** Before/after previews for UI */
  previews?: PatchPreview[];
  /** Multi-file snapshots before Keep */
  previousFiles?: Record<string, string>;
  /** SHA-256 of each affected file immediately after Keep (for stale undo) */
  postApplyHashes?: Record<string, string>;
  /** True when only legacy body exists — show text, no Keep */
  legacyDisplayOnly?: boolean;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  suggestion?: ChatSuggestion;
};

export type ProjectFile = {
  id: string;
  name: string;
  kind: "tex" | "bib" | "asset" | "cls";
};
