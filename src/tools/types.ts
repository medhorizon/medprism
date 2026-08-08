/** Pluggable tool protocol (Plan8). */

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export type ToolContext = {
  projectId: string;
  files: Record<string, string>;
  mainFile?: string;
  lastCompileLog?: string;
};

export type ToolDef = {
  name: string;
  description: string;
  /** JSON-schema-lite for docs / LLM tool hints */
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
};

export type AssistantMode = "chat" | "agent" | "tools";

export type PaperHit = {
  id: string;
  title: string;
  authors: string;
  year?: string;
  doi?: string;
  pmid?: string;
  journal?: string;
};

export type CompileLogError = {
  file?: string;
  line?: number;
  message: string;
  raw: string;
};
