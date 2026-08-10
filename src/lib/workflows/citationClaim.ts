import citationClaimInstruction from "../../../prompts/workflows/citation-claim.md?raw";
import {
  buildContextSnapshot,
  type ContextSnapshot,
  type TextSelection,
} from "../context/snapshot";
import { resolveLatexTarget } from "../latex/textTargets";
import type { LatexTargetSpec } from "../latex/types";
import type { LlmConfig, ChatRequestMessage } from "../llmClient";
import { extractJsonValue, repairJsonText } from "../replyParse";
import { taggedPromptData } from "../promptData";
import type { ToolContext } from "../../tools/types";

export type LocatedCitationClaim = {
  path: string;
  selectedText: string;
  selection: TextSelection;
  reason: string;
};

export type LocateCitationClaimResult =
  | { ok: true; claim: LocatedCitationClaim }
  | { ok: false; message: string };

type ClaimScopeFile = {
  path: string;
  excerpt: string;
  /** Offset of excerpt within the full file (0 when excerpt is the whole file / body span). */
  baseOffset: number;
};

const MAX_EXCERPT = 12_000;

function uniqueOccurrence(
  haystack: string,
  needle: string,
): TextSelection | null {
  if (!needle) return null;
  const first = haystack.indexOf(needle);
  if (first < 0) return null;
  const second = haystack.indexOf(needle, first + 1);
  if (second >= 0) return null;
  return { start: first, end: first + needle.length };
}

/** Prefer exact match; then trimmed; then unique whitespace-flexible token match. */
export function locateClaimInText(
  source: string,
  claimText: string,
): TextSelection | null {
  const exact = uniqueOccurrence(source, claimText);
  if (exact) return exact;
  const trimmed = claimText.trim();
  if (trimmed && trimmed !== claimText) {
    const byTrim = uniqueOccurrence(source, trimmed);
    if (byTrim) return byTrim;
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || trimmed.length < 12) return null;
  const pattern = tokens
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const matches = [...source.matchAll(new RegExp(pattern, "g"))];
  if (matches.length !== 1 || matches[0]?.index === undefined) return null;
  const start = matches[0].index;
  return { start, end: start + matches[0][0]!.length };
}

async function buildClaimScopes(args: {
  ctx: ToolContext;
  target?: LatexTargetSpec;
}): Promise<{ snapshot: ContextSnapshot; scopes: ClaimScopeFile[] }> {
  const snapshot = await buildContextSnapshot(args.ctx);
  const scopes: ClaimScopeFile[] = [];

  if (args.target && args.target.kind !== "selection" && args.target.kind !== "body") {
    const resolved = resolveLatexTarget(snapshot, {
      ...args.target,
      createIfMissing: false,
    });
    if (resolved.ok && resolved.target.mode === "replace_body" && resolved.target.range) {
      const rawBody = resolved.target.existingText;
      const body = rawBody.trim();
      if (body.length >= 12) {
        const trimLead = rawBody.indexOf(body);
        scopes.push({
          path: resolved.target.path,
          excerpt: body.slice(0, MAX_EXCERPT),
          baseOffset: resolved.target.range.start + Math.max(0, trimLead),
        });
      }
    }
  }

  if (scopes.length === 0) {
    const path = snapshot.activeFile;
    const full = snapshot.files[path] ?? "";
    const excerpt = (snapshot.localContext || full).slice(0, MAX_EXCERPT);
    const baseOffset = full.indexOf(excerpt);
    scopes.push({
      path,
      excerpt,
      baseOffset: baseOffset >= 0 ? baseOffset : 0,
    });
  }

  return { snapshot, scopes };
}

function parseClaimLocatorJson(raw: string): {
  claimText: string;
  path?: string;
  reason: string;
} | null {
  let value: unknown;
  try {
    value = extractJsonValue(raw);
  } catch {
    try {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start < 0 || end <= start) return null;
      value = JSON.parse(repairJsonText(raw.slice(start, end + 1)));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.claimText !== "string") return null;
  return {
    claimText: record.claimText,
    ...(typeof record.path === "string" && record.path.trim()
      ? { path: record.path.trim() }
      : {}),
    reason: typeof record.reason === "string" ? record.reason.trim() : "",
  };
}

/**
 * When citation has no editor selection, ask the model to point at one verbatim
 * claim inside runtime-owned manuscript excerpts; runtime resolves the range.
 */
export async function locateCitationClaim(args: {
  ctx: ToolContext;
  userText: string;
  config: LlmConfig;
  target?: LatexTargetSpec;
  complete: (request: {
    config: LlmConfig;
    messages: ChatRequestMessage[];
    signal?: AbortSignal;
    stream?: boolean;
  }) => Promise<string>;
  signal?: AbortSignal;
}): Promise<LocateCitationClaimResult> {
  let snapshot: ContextSnapshot;
  let scopes: ClaimScopeFile[];
  try {
    ({ snapshot, scopes } = await buildClaimScopes({
      ctx: args.ctx,
      ...(args.target ? { target: args.target } : {}),
    }));
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (!scopes.some((scope) => scope.excerpt.trim().length >= 12)) {
    return {
      ok: false,
      message: "未找到可用于补引用的稿件正文。请先选中需要支撑的论断，或补全对应章节。",
    };
  }

  const raw = await args.complete({
    config: args.config,
    stream: false,
    ...(args.signal ? { signal: args.signal } : {}),
    messages: [
      { role: "system", content: citationClaimInstruction },
      {
        role: "user",
        content: taggedPromptData(
          "workspace_context",
          'trust="untrusted-data"',
          {
            userRequest: args.userText,
            activeFile: snapshot.activeFile,
            target: args.target ?? null,
            excerpts: scopes.map((scope) => ({
              path: scope.path,
              text: scope.excerpt,
            })),
          },
        ),
      },
    ],
  });

  const parsed = parseClaimLocatorJson(raw);
  if (!parsed || !parsed.claimText.trim()) {
    return {
      ok: false,
      message:
        parsed?.reason === "no suitable claim"
          ? "模型未在当前章节中找到适合补引用的论断。请手动选中一句后再试。"
          : "无法解析模型给出的引用论断，请手动选中需要支撑的句子后再试。",
    };
  }

  const ordered = parsed.path
    ? [
        ...scopes.filter((scope) => scope.path === parsed.path),
        ...scopes.filter((scope) => scope.path !== parsed.path),
      ]
    : scopes;

  for (const scope of ordered) {
    const full = snapshot.files[scope.path];
    if (full === undefined) continue;
    // Search in excerpt first (model only saw the excerpt), then full file.
    const inExcerpt = locateClaimInText(scope.excerpt, parsed.claimText);
    if (inExcerpt) {
      return {
        ok: true,
        claim: {
          path: scope.path,
          selectedText: scope.excerpt.slice(inExcerpt.start, inExcerpt.end),
          selection: {
            start: scope.baseOffset + inExcerpt.start,
            end: scope.baseOffset + inExcerpt.end,
          },
          reason: parsed.reason || "LLM-selected claim for citation",
        },
      };
    }
    const inFull = locateClaimInText(full, parsed.claimText);
    if (inFull) {
      return {
        ok: true,
        claim: {
          path: scope.path,
          selectedText: full.slice(inFull.start, inFull.end),
          selection: inFull,
          reason: parsed.reason || "LLM-selected claim for citation",
        },
      };
    }
  }

  return {
    ok: false,
    message:
      "模型选出的论断无法在稿件中唯一定位。请手动选中需要支撑的句子后再试。",
  };
}
