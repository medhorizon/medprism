/** Shared invariants for workflows that revise existing scientific prose. */

function tokenMultiset(text: string, pattern: RegExp): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function sameTokenMultiset(
  left: Map<string, number>,
  right: Map<string, number>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [token, count] of left) {
    if (right.get(token) !== count) return false;
  }
  return true;
}

const PROTECTED_REFERENCE_COMMANDS =
  /\\(?:cite\w*|ref|eqref|autoref|cref|Cref|label)\s*(?:\[[^\]]*\]\s*)*\{[^{}]*\}/g;
const SCIENTIFIC_NUMBERS =
  /(?<![\p{L}\p{N}_])[-+]?\d+(?:[.,]\d+)*(?:\s*%|\s*(?:mg|g|kg|mL|L|mm|cm|m|km|s|min|h|day|days|week|weeks|month|months|year|years|Hz|kHz|MHz|GHz|°C|K|Pa|kPa|MPa|mmHg|µg|μg|nmol|mmol|mol))?/gu;
const INLINE_MATH = /\$[^$\r\n]+\$|\\\([^\r\n]*?\\\)|\\\[[\s\S]*?\\\]/g;
const LATEX_COMMAND_NAMES = /\\[A-Za-z@]+\*?/g;
const LATEX_ENVIRONMENT_BOUNDARIES = /\\(?:begin|end)\s*\{[^{}]+\}/g;
const BIBLIOGRAPHIC_IDENTIFIERS = /\bPMID\s*:?\s*\d+\b|\b10\.\d{4,9}\/[^\s,;]+/gi;

export function validateProtectedTextReplacement(
  original: string,
  replacement: string,
): { ok: true } | { ok: false; message: string } {
  if (!replacement.trim()) {
    return { ok: false, message: "The replacement text must not be empty." };
  }

  const invariants: Array<{ pattern: RegExp; message: string }> = [
    {
      pattern: PROTECTED_REFERENCE_COMMANDS,
      message: "The revision must preserve existing cite/ref/label commands exactly.",
    },
    {
      pattern: SCIENTIFIC_NUMBERS,
      message: "The revision must preserve numerical values and units.",
    },
    {
      pattern: INLINE_MATH,
      message: "The revision must preserve existing inline/display equations exactly.",
    },
    {
      pattern: LATEX_COMMAND_NAMES,
      message: "The revision must preserve existing LaTeX command names.",
    },
    {
      pattern: LATEX_ENVIRONMENT_BOUNDARIES,
      message: "The revision must preserve existing LaTeX environment boundaries.",
    },
    {
      pattern: BIBLIOGRAPHIC_IDENTIFIERS,
      message: "The revision must preserve existing DOI/PMID identifiers exactly.",
    },
  ];

  for (const invariant of invariants) {
    if (!sameTokenMultiset(
      tokenMultiset(original, invariant.pattern),
      tokenMultiset(replacement, invariant.pattern),
    )) {
      return { ok: false, message: invariant.message };
    }
  }
  return { ok: true };
}
