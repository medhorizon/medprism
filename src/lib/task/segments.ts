import type { MessageSegment } from "./types";

/**
 * Segment the exact user message into immutable line/list units. Models refer
 * to IDs; runtime reads the original slices and never trusts repeated prose.
 */
export function segmentUserMessage(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const linePattern = /[^\r\n]+/g;
  let index = 0;
  for (const match of text.matchAll(linePattern)) {
    if (match.index === undefined) continue;
    const raw = match[0];
    if (!raw.trim()) continue;
    const leading = raw.search(/\S/);
    const trailing = raw.length - raw.trimEnd().length;
    const start = match.index + Math.max(0, leading);
    const end = match.index + raw.length - trailing;
    segments.push({
      id: `msg-${String(index + 1).padStart(4, "0")}`,
      start,
      end,
      text: text.slice(start, end),
    });
    index += 1;
  }
  if (segments.length === 0 && text.trim()) {
    const start = text.search(/\S/);
    const end = text.length - (text.length - text.trimEnd().length);
    return [{ id: "msg-0001", start, end, text: text.slice(start, end) }];
  }
  return segments;
}

export function segmentTextByIds(
  segments: readonly MessageSegment[],
  ids: readonly string[],
): string {
  const wanted = new Set(ids);
  return segments
    .filter((segment) => wanted.has(segment.id))
    .sort((a, b) => a.start - b.start)
    .map((segment) => segment.text)
    .join("\n");
}
