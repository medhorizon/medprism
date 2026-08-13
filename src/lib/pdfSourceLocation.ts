import type { TextSelection } from "./context/snapshot";
import { assertSafeProjectRelativePath } from "./projectPath";

export type SyncTexSourceCandidate = {
  path: string;
  /** One-based source line reported by SyncTeX. */
  line: number;
};

export type PdfSourceLocation = {
  path: string;
  line: number;
  selection: TextSelection;
};

type NormalizedText = {
  text: string;
  starts: number[];
  ends: number[];
};

const NON_TEXT_COMMANDS = new Set([
  "cite",
  "citep",
  "citet",
  "eqref",
  "footnote",
  "label",
  "pageref",
  "ref",
]);

function skipBalanced(source: string, from: number, open: string, close: string): number {
  if (source[from] !== open) return from;
  let depth = 0;
  for (let index = from; index < source.length; index += 1) {
    if (source[index] === open) depth += 1;
    if (source[index] === close && --depth === 0) return index + 1;
  }
  return source.length;
}

function normalizedSource(source: string, offset = 0): NormalizedText {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let pendingSpace: { start: number; end: number } | undefined;

  const append = (value: string, start: number, end: number) => {
    if (pendingSpace && text && !text.endsWith(" ")) {
      text += " ";
      starts.push(pendingSpace.start + offset);
      ends.push(pendingSpace.end + offset);
    }
    pendingSpace = undefined;
    text += value.toLowerCase();
    starts.push(start + offset);
    ends.push(end + offset);
  };

  for (let index = 0; index < source.length;) {
    const char = source[index]!;
    if (/\s/.test(char)) {
      const start = index;
      while (index < source.length && /\s/.test(source[index]!)) index += 1;
      pendingSpace = { start, end: index };
      continue;
    }
    if (char === "%") {
      const newline = source.indexOf("\n", index);
      index = newline < 0 ? source.length : newline;
      continue;
    }
    if (char === "\\") {
      const escaped = source[index + 1];
      if (escaped && /[%&_#${}]/.test(escaped)) {
        append(escaped, index, index + 2);
        index += 2;
        continue;
      }
      const command = source.slice(index + 1).match(/^[A-Za-z@]+\*?/)?.[0] ?? "";
      if (!command) {
        index += Math.min(2, source.length - index);
        continue;
      }
      index += command.length + 1;
      if (NON_TEXT_COMMANDS.has(command.replace(/\*$/, ""))) {
        while (index < source.length && /\s/.test(source[index]!)) index += 1;
        if (source[index] === "[") index = skipBalanced(source, index, "[", "]");
        while (index < source.length && /\s/.test(source[index]!)) index += 1;
        if (source[index] === "{") index = skipBalanced(source, index, "{", "}");
      }
      continue;
    }
    if (char === "{" || char === "}" || char === "~") {
      if (char === "~") pendingSpace = { start: index, end: index + 1 };
      index += 1;
      continue;
    }
    append(char, index, index + 1);
    index += 1;
  }
  return { text: text.trimEnd(), starts, ends };
}

function normalizedPdfText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();
}

function compactSource(value: NormalizedText): NormalizedText {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (let index = 0; index < value.text.length; index += 1) {
    const character = value.text[index]!;
    if (!/[\p{L}\p{N}]/u.test(character)) continue;
    text += character.normalize("NFKC").toLowerCase();
    starts.push(value.starts[index]!);
    ends.push(value.ends[index]!);
  }
  return { text, starts, ends };
}

function lineWindow(content: string, line: number, radius: number): { start: number; text: string } {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") starts.push(index + 1);
  }
  const center = Math.max(0, Math.min(starts.length - 1, line - 1));
  const first = Math.max(0, center - radius);
  const last = Math.min(starts.length, center + radius + 1);
  const start = starts[first]!;
  const end = last < starts.length ? starts[last]! : content.length;
  return { start, text: content.slice(start, end) };
}

function lineStartOffset(content: string, line: number): number {
  let offset = 0;
  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const newline = content.indexOf("\n", offset);
    if (newline < 0) return content.length;
    offset = newline + 1;
  }
  return offset;
}

function closestMatch(text: string, needle: string, offsets: readonly number[], target: number): number {
  let match = text.indexOf(needle);
  let closest = -1;
  let closestDistance = Number.POSITIVE_INFINITY;
  while (match >= 0) {
    const distance = Math.abs(offsets[match]! - target);
    if (distance < closestDistance) {
      closest = match;
      closestDistance = distance;
    }
    match = text.indexOf(needle, match + 1);
  }
  return closest;
}

function includeSelectedSentenceEnding(source: string, end: number, selectedText: string): number {
  if (!/[.!?;:]\s*$/u.test(selectedText)) return end;
  const trailing = source.slice(end).match(
    /^(?:\s*\\cite\w*\s*(?:\[[^\]]*\]\s*)*\{[^}]+\})*\s*[.!?;:]/u,
  );
  return trailing ? end + trailing[0].length : end;
}

function projectPath(candidatePath: string, files: Readonly<Record<string, string>>): string | null {
  const normalized = candidatePath.replace(/\\/g, "/");
  if (normalized in files) return assertSafeProjectRelativePath(normalized);
  const matches = Object.keys(files).filter((path) => normalized.endsWith(`/${path}`));
  return matches.length === 1 ? assertSafeProjectRelativePath(matches[0]!) : null;
}

/** Resolves rendered PDF text to the closest exact source range near SyncTeX candidates. */
export function locatePdfTextInSource(args: {
  selectedText: string;
  candidates: readonly SyncTexSourceCandidate[];
  files: Readonly<Record<string, string>>;
  lineRadius?: number;
}): PdfSourceLocation | null {
  const needle = normalizedPdfText(args.selectedText);
  if (!needle) return null;

  for (const candidate of args.candidates) {
    if (!Number.isInteger(candidate.line) || candidate.line < 1) continue;
    const path = projectPath(candidate.path, args.files);
    if (!path || !path.toLowerCase().endsWith(".tex")) continue;
    const content = args.files[path]!;
    const window = lineWindow(content, candidate.line, args.lineRadius ?? 8);
    const normalized = compactSource(normalizedSource(window.text, window.start));
    const match = closestMatch(
      normalized.text,
      needle,
      normalized.starts,
      lineStartOffset(content, candidate.line),
    );
    if (match < 0) continue;
    const endIndex = match + needle.length - 1;
    const end = includeSelectedSentenceEnding(
      content,
      normalized.ends[endIndex]!,
      args.selectedText,
    );
    return {
      path,
      line: candidate.line,
      selection: { start: normalized.starts[match]!, end },
    };
  }
  return null;
}
