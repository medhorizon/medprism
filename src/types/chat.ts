export type ChatRole = "user" | "assistant";

export type SuggestionStatus = "pending" | "applied" | "undone" | "dismissed";

export type ChatSuggestion = {
  title: string;
  body: string;
  /** Explicit project-relative path for Keep */
  path?: string;
  status?: SuggestionStatus;
  /** Target file id after Keep */
  appliedTo?: string;
  /** File content snapshot before Keep, used by Undo */
  previousContent?: string;
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
