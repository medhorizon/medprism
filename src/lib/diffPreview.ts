import type { SourceRange } from "./patch/schema";

export function lineContextSnippet(
  content: string,
  range: SourceRange,
  contextLines = 3,
): string {
  const lines = content.split("\n");
  const startLine = content.slice(0, range.start).split("\n").length - 1;
  const changedText = content.slice(range.start, range.end);
  const changedLines = Math.max(1, changedText.split("\n").length);
  const endLine = Math.min(lines.length - 1, startLine + changedLines - 1);
  const first = Math.max(0, startLine - contextLines);
  const last = Math.min(lines.length, endLine + contextLines + 1);
  const snippet = lines.slice(first, last).join("\n");
  return `${first > 0 ? "…\n" : ""}${snippet}${last < lines.length ? "\n…" : ""}`;
}

export type TextDiffParts = {
  prefix: string;
  beforeChanged: string;
  afterChanged: string;
  suffix: string;
};

export function splitTextDiff(before: string, after: string): TextDiffParts {
  let prefixLength = 0;
  const shortest = Math.min(before.length, after.length);
  while (prefixLength < shortest && before[prefixLength] === after[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < shortest - prefixLength &&
    before[before.length - 1 - suffixLength] === after[after.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return {
    prefix: before.slice(0, prefixLength),
    beforeChanged: before.slice(prefixLength, before.length - suffixLength),
    afterChanged: after.slice(prefixLength, after.length - suffixLength),
    suffix: suffixLength ? before.slice(before.length - suffixLength) : "",
  };
}
