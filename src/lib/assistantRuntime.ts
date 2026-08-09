import agentsMd from "../../AGENTS.md?raw";
import medprismContract from "../../skills/_medprism-contract.md?raw";
import scientificWritingSkill from "../../skills/scientific-writing/SKILL.md?raw";
import academicPaperSkill from "../../skills/academic-paper/SKILL.md?raw";
import academicPaperReviewerSkill from "../../skills/academic-paper-reviewer/SKILL.md?raw";
import latexPaperEnSkill from "../../skills/latex-paper-en/SKILL.md?raw";
import natureCitationSkill from "../../skills/nature-citation/SKILL.md?raw";
import naturePolishingSkill from "../../skills/nature-polishing/SKILL.md?raw";
import natureWritingSkill from "../../skills/nature-writing/SKILL.md?raw";
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
  detectSkillIntent,
  detectWritingDomain,
  skillIdsForIntent,
  type SkillIntent,
} from "./skillRouter";
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
  /** Force a skill path; `auto` uses detectSkillIntent */
  intent?: "auto" | SkillIntent | "cite" | "fix-compile" | "general";
};

export type RuntimeResult = {
  content: string;
  suggestions: NonNullable<ChatMessage["suggestion"]>[];
  toolNotes: string[];
  lastCompileLog?: string;
  pdfBase64?: string;
};

/** @deprecated use detectSkillIntent */
export function detectIntent(text: string): SkillIntent {
  return detectSkillIntent(text);
}

function resolveIntent(
  text: string,
  forced?: RuntimeRequest["intent"],
): SkillIntent {
  if (!forced || forced === "auto") return detectSkillIntent(text);
  if (forced === "general") return "write";
  return forced;
}

function projectDomainHint(ctx: ToolContext): string {
  const main =
    (ctx.mainFile && ctx.files[ctx.mainFile]) ||
    ctx.files["main.tex"] ||
    Object.entries(ctx.files).find(([k]) => k.endsWith(".tex"))?.[1] ||
    "";
  return main.slice(0, 2000);
}

function skillBodies(
  intent: SkillIntent,
  userText: string,
  projectHint: string,
): string {
  const ids = skillIdsForIntent(intent, userText, projectHint);
  const chunks: string[] = [medprismContract];

  for (const id of ids) {
    switch (id) {
      case "scientific-writing":
        chunks.push(scientificWritingSkill);
        break;
      case "academic-paper":
        chunks.push(academicPaperSkill);
        break;
      case "academic-paper-reviewer":
        chunks.push(academicPaperReviewerSkill);
        break;
      case "latex-paper-en":
        chunks.push(latexPaperEnSkill);
        break;
      case "nature-citation":
        chunks.push(natureCitationSkill);
        chunks.push(literatureCiteSkill);
        break;
      case "nature-polishing":
        chunks.push(naturePolishingSkill);
        break;
      case "nature-writing":
        chunks.push(natureWritingSkill);
        break;
      case "fix-compile-errors":
        chunks.push(fixCompileSkill);
        break;
      default:
        break;
    }
  }

  return chunks.join("\n\n---\n\n");
}

function buildSystemPrompt(
  mode: AssistantMode,
  intent: SkillIntent,
  userText: string,
  projectHint: string,
): string {
  const domain = detectWritingDomain(userText, projectHint);
  const ids = skillIdsForIntent(intent, userText, projectHint);

  const toolHint =
    mode === "review"
      ? "Mode: review (peer review). Produce a structured referee report + revision roadmap from the manuscript context. Do not bulk-rewrite unless the user explicitly asks to apply a fix."
      : "Mode: assistant (natural language). Skills and tools are selected automatically from the user request. Propose file edits only as suggestions (Keep required).";

  const pipelineHint =
    intent === "review"
      ? "Pipeline: academic-paper-reviewer produces a peer-review report + revision roadmap; do not bulk-rewrite the manuscript unless the user explicitly asks to apply a fix."
      : intent === "cite"
        ? "Pipeline: nature-citation generates BibTeX/keys from paper_search; latex-paper-en wires .bib + \\cite only (no content rewrite)."
        : intent === "write" || intent === "nature-writing"
          ? domain === "general"
            ? "Pipeline: non-biomedical content → academic-paper owns manuscript content; latex-paper-en is format-only."
            : "Pipeline: biomedical content → scientific-writing owns manuscript content; latex-paper-en is format-only."
          : intent === "latex" || intent === "fix-compile"
            ? "Pipeline: latex-paper-en is format/engineering only — do not rewrite scientific claims."
            : "";

  return [
    agentsMd,
    "",
    toolHint,
    "",
    `Active skill route: ${intent} / domain=${domain} → ${ids.join(" + ")}`,
    pipelineHint,
    "",
    "Output protocol:",
    replyFormats,
    "",
    "Active skills:",
    skillBodies(intent, userText, projectHint),
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
    .replace(/补充|添加|加入|引用|参考文献|citation|cite|add|please|请|分段引用|补引用/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || userText.trim();
}

export async function runAssistant(req: RuntimeRequest): Promise<RuntimeResult> {
  const intent = resolveIntent(req.userText, req.intent);
  const projectHint = projectDomainHint(req.ctx);
  const domain = detectWritingDomain(req.userText, projectHint);
  const allowed = new Set(toolsForMode(req.mode));
  const toolNotes: string[] = [
    `skills: ${skillIdsForIntent(intent, req.userText, projectHint).join(", ")}`,
    `domain: ${domain}`,
  ];
  let lastCompileLog = req.ctx.lastCompileLog;
  let pdfBase64: string | undefined;
  const toolBlocks: string[] = [];

  if (intent === "cite" && allowed.has("paper_search")) {
    const { notes, toolBlock } = await runCitationTools(req.userText, req.ctx);
    toolNotes.push(...notes);
    toolBlocks.push(toolBlock);
  }

  if (
    intent === "fix-compile" &&
    (allowed.has("compile") || allowed.has("parse_compile_log"))
  ) {
    const ctx = { ...req.ctx };
    const fix = await runCompileFixTools(ctx);
    toolNotes.push(...fix.notes);
    toolBlocks.push(fix.toolBlock);
    lastCompileLog = fix.lastCompileLog ?? lastCompileLog;
    pdfBase64 = fix.pdfBase64;
  }

  const system = buildSystemPrompt(
    req.mode,
    intent,
    req.userText,
    projectHint,
  );
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
