import type { ToolContext, ToolDef, ToolResult } from "./types";

const tools = new Map<string, ToolDef>();

export function registerTool(tool: ToolDef) {
  tools.set(tool.name, tool);
}

export function listTools(names?: string[]): ToolDef[] {
  const all = [...tools.values()];
  if (!names) return all;
  const allow = new Set(names);
  return all.filter((t) => allow.has(t.name));
}

export function getTool(name: string): ToolDef | undefined {
  return tools.get(name);
}

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = tools.get(name);
  if (!tool) {
    return { ok: false, error: `Unknown tool: ${name}` };
  }
  try {
    return await tool.execute(args, ctx);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Tools allowed per assistant mode. */
export function toolsForMode(mode: "assistant" | "review"): string[] {
  // Unified NL assistant: auto-route skills + full tools when intent needs them.
  if (mode === "assistant") return ["paper_search", "compile", "parse_compile_log"];
  // Review tab: report-only, no tools.
  return [];
}
