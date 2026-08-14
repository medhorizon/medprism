import searchQueryInstruction from "../../../prompts/workflows/search-query.md?raw";
import { extractJsonValue, repairJsonText } from "../replyParse";
import { taggedPromptData } from "../promptData";
import type { LlmConfig } from "../llmClient";
import type { ModelCompletionRequest } from "../workflows/types";

const MIN_QUERY_CHARS = 2;
const MAX_QUERY_CHARS = 300;
const MIN_SINCE_YEAR = 1900;

export type FormulatedSearchQuery = {
  query: string;
  sinceYear?: number;
};

export function parseSearchQueryProposal(
  raw: string,
  nowYear = new Date().getFullYear(),
): FormulatedSearchQuery | null {
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
  const query = typeof record.query === "string"
    ? record.query.replace(/\s+/g, " ").trim()
    : "";
  if (query.length < MIN_QUERY_CHARS || query.length > MAX_QUERY_CHARS) return null;

  const result: FormulatedSearchQuery = { query };
  if (record.sinceYear !== undefined) {
    const year = typeof record.sinceYear === "number"
      ? record.sinceYear
      : typeof record.sinceYear === "string"
        ? Number(record.sinceYear)
        : NaN;
    if (Number.isInteger(year) && year >= MIN_SINCE_YEAR && year <= nowYear + 1) {
      result.sinceYear = year;
    }
  }
  return result;
}

/**
 * Ask the model for a keyword literature query. Runtime still executes paper_search.
 * Invalid JSON falls through to the existing selected-claim query.
 */
export async function formulateSearchQuery(args: {
  userText: string;
  selectedText?: string;
  complete: (request: ModelCompletionRequest) => Promise<string>;
  config: LlmConfig;
  signal?: AbortSignal;
}): Promise<({ ok: true } & FormulatedSearchQuery) | { ok: false }> {
  const raw = await args.complete({
    config: args.config,
    stream: false,
    ...(args.signal ? { signal: args.signal } : {}),
    messages: [
      { role: "system", content: searchQueryInstruction },
      {
        role: "user",
        content: taggedPromptData("user_request", 'trust="untrusted-data"', {
          text: args.userText,
          selectedClaim: args.selectedText ?? null,
        }),
      },
    ],
  });
  const parsed = parseSearchQueryProposal(raw);
  return parsed ? { ok: true, ...parsed } : { ok: false };
}
