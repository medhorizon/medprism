import { compileTool } from "./compile";
import { paperSearchTool } from "./paperSearch";
import { parseCompileLogTool } from "./parseCompileLog";
import { registerTool } from "./registry";

let registered = false;

/** Idempotent registration of built-in Plan8 tools. */
export function ensureToolsRegistered() {
  if (registered) return;
  registerTool(paperSearchTool);
  registerTool(compileTool);
  registerTool(parseCompileLogTool);
  registered = true;
}

export type { AssistantMode, PaperHit, ToolContext, ToolDef, ToolResult } from "./types";
export { listTools, runTool, toolsForMode, getTool } from "./registry";
export { paperHitToBibtex, citeKey } from "./bibtex";
export { searchEuropePmc } from "./paperSearch";
export { parseCompileLog } from "./parseCompileLog";
