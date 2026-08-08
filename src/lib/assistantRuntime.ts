import agentsMd from "../../AGENTS.md?raw";
import literatureCiteSkill from "../../skills/literature-cite/SKILL.md?raw";
import fixCompileSkill from "../../skills/fix-compile-errors/SKILL.md?raw";
import replyFormats from "../../prompts/reply.formats.md?raw";
import {
  chatCompletions,
  type ChatRequestMessage,
  type LlmConfig,
} from "./llmClient";
import { parseAssistantReply } from "./replyParse";
import {
  ensureToolsRegistered,
  runTool,
  toolsForMode,
  type AssistantMode,
  type ToolContext,
} from "../tools";
import type { ChatMessage } from "../types/chat";

ensureToolsRegistered();

export type RuntimeRequest = {
  mode: AssistantMode;
  config: LlmConfig;
  userText: string;
  history: ChatRequestMessage[];
  ctx: ToolContext;
  /** Force a skill path (e.g. fix-compile / literature-cite) */
  intent?: "auto" | "cite" | "fix-compile" | "general";
};

export type RuntimeResult = {
  content: string;
  suggestions: NonNullable<ChatMessage["suggestion"]>[];
  toolNotes: string[];
  lastCompileLog?: string;
  pdfBase64?: string;
};

export function detectIntent(text: string): "cite" | "fix-compile" | "general" {
  const lower = text.toLowerCase();
  if (
    /cite|citation|引用|参考文献|bibtex|sepsis-3|pubmed|pmid|doi|literature|paper/.test(
      lower,
    )
  ) {
    return "cite";
  }
  if (
    /compile|编译|warning|error|fix with ai|诊断|latex\s*log|tectonic/.test(lower)
  ) {
    return "fix-compile";
  }
  return "general";
}

function buildSystemPrompt(mode: AssistantMode, intent: string): string {
  const skill =
    intent === "cite"
      ? literatureCiteSkill
      : intent === "fix-compile"
        ? fixCompileSkill
        : "";

  const toolHint =
    mode === "chat"
      ? "Mode: chat (no tools). Answer only; do not claim you searched or compiled."
      : mode === "agent"
        ? "Mode: agent. You may receive paper_search results. Propose file edits only as suggestions (Keep required)."
        : "Mode: tools. You may receive paper_search / compile / parse_compile_log results. Propose file edits as suggestions.";

  return [
    agentsMd,
    "",
    toolHint,
    "",
    "Output protocol:",
    replyFormats,
    skill ? `\nActive skill:\n${skill}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function projectContext(ctx: ToolContext): string {
  const names = Object.keys(ctx.files).slice(0, 40).join(", ");
  const bib =
    Object.entries(ctx.files).find(([k]) => k.endsWith(".bib"))?.[1]?.slice(0, 1500) ??
    "(no .bib)";
  const main =
    (ctx.mainFile && ctx.files[ctx.mainFile]) ||
    ctx.files["main.tex"] ||
    Object.entries(ctx.files).find(([k]) => k.endsWith(".tex"))?.[1] ||
    "";
  return [
    `Project files: ${names}`,
    `Main excerpt:\n${main.slice(0, 2500)}`,
    `Bibliography excerpt:\n${bib}`,
    ctx.lastCompileLog
      ? `Last compile log (truncated):\n${ctx.lastCompileLog.slice(0, 3000)}`
      : "No compile log yet.",
  ].join("\n\n");
}

async function runCitationTools(
  userText: string,
  ctx: ToolContext,
): Promise<{ notes: string[]; toolBlock: string }> {
  const query = extractSearchQuery(userText);
  const result = await runTool("paper_search", { query, pageSize: 5 }, ctx);
  if (!result.ok) {
    return {
      notes: [`paper_search failed: ${result.error}`],
      toolBlock: `TOOL paper_search ERROR: ${result.error}\nDo NOT invent citations. Tell the user retrieval failed.`,
    };
  }
  const data = result.data as { count: number; hits: unknown[] };
  if (!data.count) {
    return {
      notes: ["paper_search: 0 hits"],
      toolBlock:
        "TOOL paper_search returned 0 hits. Say no literature was found. Do NOT invent PMID/DOI/BibTeX.",
    };
  }
  return {
    notes: [`paper_search: ${data.count} hit(s) for "${query}"`],
    toolBlock: `TOOL paper_search results (use ONLY these metadata; BibTeX is authoritative):\n${JSON.stringify(data.hits, null, 2)}`,
  };
}

async function runCompileFixTools(
  ctx: ToolContext,
): Promise<{ notes: string[]; toolBlock: string; lastCompileLog?: string; pdfBase64?: string }> {
  const notes: string[] = [];
  let log = ctx.lastCompileLog || "";

  if (!log.trim()) {
    const compiled = await runTool("compile", {}, ctx);
    notes.push("compile: invoked");
    if (!compiled.ok) {
      return {
        notes: [...notes, `compile error: ${compiled.error}`],
        toolBlock: `TOOL compile ERROR: ${compiled.error}`,
      };
    }
    const data = compiled.data as {
      compileOk: boolean;
      log: string;
      pdfBase64?: string;
      error?: string;
    };
    log = data.log || "";
    if (data.compileOk) {
      return {
        notes: [...notes, "compile: ok"],
        toolBlock: "TOOL compile succeeded. No fix needed. Summarize success briefly.",
        lastCompileLog: log,
        pdfBase64: data.pdfBase64,
      };
    }
    notes.push("compile: failed");
  }

  const parsed = await runTool("parse_compile_log", { log }, { ...ctx, lastCompileLog: log });
  if (!parsed.ok) {
    return {
      notes: [...notes, `parse_compile_log: ${parsed.error}`],
      toolBlock: `Compile log:\n${log.slice(0, 4000)}\n\nParse failed: ${parsed.error}`,
      lastCompileLog: log,
    };
  }

  return {
    notes: [...notes, "parse_compile_log: ok"],
    toolBlock: `TOOL parse_compile_log:\n${JSON.stringify(parsed.data, null, 2)}\n\nPropose a MINIMAL suggestion patch for the broken file.`,
    lastCompileLog: log,
  };
}

function extractSearchQuery(userText: string): string {
  const cleaned = userText
    .replace(/补充|添加|加入|引用|参考文献|citation|cite|add|please|请/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || userText.trim();
}

export async function runAssistant(req: RuntimeRequest): Promise<RuntimeResult> {
  const intent =
    req.intent && req.intent !== "auto" ? req.intent : detectIntent(req.userText);
  const allowed = new Set(toolsForMode(req.mode));
  const toolNotes: string[] = [];
  let lastCompileLog = req.ctx.lastCompileLog;
  let pdfBase64: string | undefined;
  const toolBlocks: string[] = [];

  if (intent === "cite" && allowed.has("paper_search")) {
    const { notes, toolBlock } = await runCitationTools(req.userText, req.ctx);
    toolNotes.push(...notes);
    toolBlocks.push(toolBlock);
  }

  if (intent === "fix-compile" && (allowed.has("compile") || allowed.has("parse_compile_log"))) {
    if (req.mode === "tools" || allowed.has("parse_compile_log")) {
      // agent: parse only if log exists; tools: may compile
      const ctx = { ...req.ctx };
      if (req.mode === "agent" && !ctx.lastCompileLog) {
        toolBlocks.push(
          "No compile log in context. Ask user to Compile first, or switch to tools mode.",
        );
        toolNotes.push("fix-compile: skipped (no log in agent mode)");
      } else {
        if (req.mode === "agent") {
          const parsed = await runTool(
            "parse_compile_log",
            { log: ctx.lastCompileLog },
            ctx,
          );
          if (parsed.ok) {
            toolNotes.push("parse_compile_log: ok");
            toolBlocks.push(`TOOL parse_compile_log:\n${JSON.stringify(parsed.data, null, 2)}`);
          }
        } else {
          const fix = await runCompileFixTools(ctx);
          toolNotes.push(...fix.notes);
          toolBlocks.push(fix.toolBlock);
          lastCompileLog = fix.lastCompileLog ?? lastCompileLog;
          pdfBase64 = fix.pdfBase64;
        }
      }
    }
  }

  // In tools mode, also allow opportunistic paper_search if user clearly cites mid-general
  // (already handled via intent).

  const system = buildSystemPrompt(req.mode, intent);
  const messages: ChatRequestMessage[] = [
    { role: "system", content: system },
    {
      role: "user",
      content: `Workspace context:\n${projectContext(req.ctx)}`,
    },
    ...req.history.slice(-10),
  ];

  if (toolBlocks.length) {
    messages.push({
      role: "user",
      content: toolBlocks.join("\n\n"),
    });
  }

  messages.push({ role: "user", content: req.userText });

  const raw = await chatCompletions({ config: req.config, messages });
  const parsed = parseAssistantReply(raw);

  const suggestions = parsed.suggestions.map((s) => ({
    ...s,
    path: s.path,
    title:
      s.path && s.title && s.title !== s.path
        ? `${s.path} · ${s.title}`
        : s.title || s.path || "suggestion",
  }));

  return {
    content: parsed.content || raw,
    suggestions,
    toolNotes,
    lastCompileLog,
    pdfBase64,
  };
}
