import type {
  FileSnapshot,
  PatchPreview,
  PatchSet,
  PatchValidationError,
} from "../lib/patch/schema";
import type { TaskSpec } from "../lib/task/types";

export type ChatRole = "user" | "assistant";
export type SuggestionStatus = "pending" | "applied" | "undone" | "dismissed";

export type ConversationArtifactKind =
  | "block"
  | "line"
  | "list-item"
  | "quoted"
  | "emphasis"
  | "assignment-value";

/** Runtime-owned exact text slice. Models may select the ID, never rewrite the text. */
export type ConversationArtifact = {
  id: string;
  messageId: string;
  role: ChatRole;
  kind: ConversationArtifactKind;
  start: number;
  end: number;
  text: string;
  textHash: string;
};

export type PendingFileTaskStatus =
  | "awaiting-confirmation"
  | "confirmed"
  | "cancelled"
  | "superseded"
  | "expired";

export type PendingFileTask = {
  schemaVersion: "1";
  id: string;
  projectId: string;
  projectRevision: string;
  createdAt: string;
  status: PendingFileTaskStatus;
  spec: TaskSpec;
  sources: ConversationArtifact[];
  targets: Array<{
    id: string;
    slot: string;
    path?: string;
    operation: "generate" | "replace" | "insert" | "scaffold" | "cite" | "repair";
    preview?: string;
  }>;
  selection?: {
    path: string;
    start: number;
    end: number;
    textHash: string;
  };
};

export type ChatConfirmation = {
  task: PendingFileTask;
  status: PendingFileTaskStatus;
};

export type AssistantOutcomeKind =
  | "answer"
  | "confirmation-required"
  | "patch-proposed"
  | "blocked";

export type ChatExecution = {
  schemaVersion: "1";
  outcome: AssistantOutcomeKind;
  taskSource: "llm" | "locked" | "invalid" | "resumed";
  action?: TaskSpec["action"];
  targetCount: number;
  failureCode?: string;
};

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
  artifacts?: ConversationArtifact[] | undefined;
  confirmation?: ChatConfirmation | undefined;
  execution?: ChatExecution | undefined;
  /** True while an assistant reply is in flight; never persist as a finished answer. */
  pending?: boolean | undefined;
};

export type ProjectFile = {
  id: string;
  name: string;
  kind: "tex" | "bib" | "asset" | "cls";
};
