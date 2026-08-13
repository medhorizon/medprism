import type { ConversationContext, TextSelection } from "../lib/context/snapshot";

export type AssistantMode = "assistant" | "review";

export type ToolContext = {
  projectId: string;
  files: Record<string, string>;
  mainFile?: string;
  activeFile?: string;
  cursor?: number;
  selection?: TextSelection;
  /** Optional UI copy; runtime recomputes this from files + selection. */
  selectedText?: string;
  projectRevision?: string;
  lastCompileLog?: string;
  /** Optional durable project notes (journal prefs, terminology, decisions). */
  memoryNotes?: string;
  /** Runtime-derived recent confirmations; never treated as instructions. */
  conversationContext?: ConversationContext;
};

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; code?: string };

export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
};

export type PaperHit = {
  id: string;
  title: string;
  authors: string;
  year?: string;
  doi?: string;
  pmid?: string;
  journal?: string;
  abstract?: string;
  source?: string;
};

export type CompileLogError = {
  severity: "error" | "warning" | "info";
  file?: string;
  line?: number;
  message: string;
  raw: string;
  isRootCause: boolean;
};
