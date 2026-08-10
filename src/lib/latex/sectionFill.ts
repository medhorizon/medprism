import type { ContextSnapshot } from "../context/snapshot";
import type { PatchSet, ReplaceTextOperation } from "../patch/schema";
import { simulatePatchSet } from "../patch/simulate";
import {
  assembleConcurrentReplaceOps,
} from "./scaffold";
import { buildLatexTextPatch, resolveLatexTarget } from "./textTargets";
import type { LatexTargetKind, LatexTargetSpec } from "./types";

export type SectionFill = {
  spec: LatexTargetSpec;
  heading: string;
  text: string;
};

export type SectionFillBuildResult =
  | {
      ok: true;
      patchSet: PatchSet;
      applied: string[];
      skipped: string[];
    }
  | { ok: false; message: string };

type HeadingAlias = {
  kind: LatexTargetKind;
  alias: string;
  sectionTitle?: string;
};

/** Known manuscript labels that users paste with ready-to-apply prose. */
const HEADING_ALIASES_UNSORTED: HeadingAlias[] = [
  { kind: "funding", alias: "funding information" },
  { kind: "funding", alias: "financial support" },
  { kind: "funding", alias: "funding" },
  { kind: "funding", alias: "基金" },
  { kind: "funding", alias: "资助" },
  { kind: "acknowledgements", alias: "acknowledgements" },
  { kind: "acknowledgements", alias: "acknowledgments" },
  { kind: "acknowledgements", alias: "acknowledgement" },
  { kind: "acknowledgements", alias: "acknowledgment" },
  { kind: "acknowledgements", alias: "致谢" },
  { kind: "author-contributions", alias: "author contributions" },
  { kind: "author-contributions", alias: "authors contributions" },
  { kind: "author-contributions", alias: "作者贡献" },
  { kind: "author-contributions", alias: "作者分工" },
  { kind: "data-availability", alias: "data availability" },
  { kind: "data-availability", alias: "availability of data" },
  { kind: "data-availability", alias: "数据可用性" },
  { kind: "data-availability", alias: "数据共享" },
  { kind: "ethics", alias: "ethics approval" },
  { kind: "ethics", alias: "ethical approval" },
  { kind: "ethics", alias: "ethics statement" },
  { kind: "ethics", alias: "伦理声明" },
  { kind: "ethics", alias: "伦理审批" },
  { kind: "conflict-of-interest", alias: "conflicts of interest" },
  { kind: "conflict-of-interest", alias: "conflict of interest" },
  { kind: "conflict-of-interest", alias: "competing interests" },
  { kind: "conflict-of-interest", alias: "利益冲突" },
  { kind: "conflict-of-interest", alias: "竞争性利益" },
  {
    kind: "section",
    alias: "consent for publication",
    sectionTitle: "Consent for publication",
  },
  {
    kind: "section",
    alias: "materials availability",
    sectionTitle: "Materials availability",
  },
  {
    kind: "section",
    alias: "code availability",
    sectionTitle: "Code availability",
  },
  {
    kind: "section",
    alias: "supplementary information",
    sectionTitle: "Supplementary Information",
  },
  {
    kind: "section",
    alias: "supporting information",
    sectionTitle: "Supplementary Information",
  },
  { kind: "abstract", alias: "abstract" },
  { kind: "abstract", alias: "摘要" },
  { kind: "introduction", alias: "introduction" },
  { kind: "introduction", alias: "引言" },
  { kind: "methods", alias: "materials and methods" },
  { kind: "methods", alias: "methods" },
  { kind: "methods", alias: "方法" },
  { kind: "results", alias: "results" },
  { kind: "results", alias: "结果" },
  { kind: "discussion", alias: "discussion" },
  { kind: "discussion", alias: "讨论" },
  { kind: "conclusion", alias: "conclusions" },
  { kind: "conclusion", alias: "conclusion" },
  { kind: "conclusion", alias: "结论" },
  { kind: "keywords", alias: "keywords" },
  { kind: "keywords", alias: "关键词" },
];

const HEADING_ALIASES: HeadingAlias[] = [...HEADING_ALIASES_UNSORTED].sort(
  (a, b) => b.alias.length - a.alias.length,
);

const INSTRUCTION_BODY_RE =
  /^(?:请|帮我|麻烦|先)?\s*(?:写|撰写|起草|生成|准备|完善|补充|修改|润色|更新|draft|write|prepare|compose|revise|polish)\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Repair common PDF / Word soft wraps before heading split. */
export function repairPastedProseWraps(text: string): string {
  return text
    .replace(/\r\n?|\r/g, "\n")
    .replace(/(\w)-\n(\w)/g, "$1$2")
    .replace(/([A-Za-z])\n([a-z])/g, "$1$2");
}

function labelFor(spec: LatexTargetSpec, heading: string): string {
  if (spec.kind === "section") return spec.sectionTitle?.trim() || heading;
  return heading;
}

function isUsableFillBody(body: string): boolean {
  const text = body.replace(/\s+/g, " ").trim();
  if (text.length < 12) return false;
  if (INSTRUCTION_BODY_RE.test(text)) return false;
  return true;
}

function toSpec(hit: HeadingAlias): LatexTargetSpec {
  if (hit.kind === "section") {
    return {
      kind: "section",
      sectionTitle: hit.sectionTitle ?? hit.alias,
      createIfMissing: true,
    };
  }
  return { kind: hit.kind, createIfMissing: true };
}

/**
 * Parse user-provided labeled manuscript blocks, e.g.
 * "Author contributions … Funding … Data availability …".
 * Runtime owns placement; the model must not invent oldText anchors.
 */
export function parseProvidedSectionFills(userText: string): SectionFill[] {
  const source = repairPastedProseWraps(userText);
  type Hit = {
    start: number;
    end: number;
    alias: HeadingAlias;
  };
  const rawHits: Hit[] = [];

  for (const alias of HEADING_ALIASES) {
    const pattern = new RegExp(
      `(?:^|[\\n:;：]|\\.(?=\\s))\\s*(${escapeRegExp(alias.alias)})(?=\\s|[.。:：]|$)`,
      "gi",
    );
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      const matched = match[1];
      if (!matched) continue;
      const start = match.index + match[0].length - matched.length;
      const end = start + matched.length;
      rawHits.push({ start, end, alias });
    }
  }

  // Longest alias first, then drop overlapping shorter labels.
  rawHits.sort(
    (a, b) => b.alias.alias.length - a.alias.alias.length || a.start - b.start,
  );
  const hits: Hit[] = [];
  for (const candidate of rawHits) {
    const overlaps = hits.some(
      (hit) => !(candidate.end <= hit.start || candidate.start >= hit.end),
    );
    if (!overlaps) hits.push(candidate);
  }
  hits.sort((a, b) => a.start - b.start);
  const fills: SectionFill[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < hits.length; index += 1) {
    const hit = hits[index]!;
    const next = hits[index + 1];
    const body = source.slice(hit.end, next?.start ?? source.length).replace(
      /^[\s:：.\-–—]+/,
      "",
    );
    if (!isUsableFillBody(body)) continue;
    const spec = toSpec(hit.alias);
    const key =
      spec.kind === "section"
        ? `section:${spec.sectionTitle?.toLowerCase() ?? ""}`
        : spec.kind;
    if (seen.has(key)) continue;
    seen.add(key);
    fills.push({
      spec,
      heading: hit.alias.sectionTitle ?? hit.alias.alias,
      text: body.trim(),
    });
  }

  return fills;
}

/** True when the user pasted ≥2 labeled section bodies ready to apply. */
export function isProvidedSectionFillRequest(text: string): boolean {
  return parseProvidedSectionFills(text).length >= 2;
}

/**
 * Build a Keep-ready PatchSet that writes user-provided prose into each
 * labeled target. Placement and hashes stay runtime-owned.
 */
export async function buildSectionFillFromUserText(
  snapshot: ContextSnapshot,
  userText: string,
): Promise<SectionFillBuildResult> {
  const fills = parseProvidedSectionFills(userText);
  if (fills.length < 2) {
    return {
      ok: false,
      message:
        "Need at least two labeled section bodies in the request to apply a provided multi-section fill.",
    };
  }

  const stepOps: ReplaceTextOperation[] = [];
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const fill of fills) {
    const label = labelFor(fill.spec, fill.heading);
    const resolved = resolveLatexTarget(snapshot, {
      ...fill.spec,
      createIfMissing: true,
    });
    if (!resolved.ok) {
      skipped.push(`${label} (${resolved.message})`);
      continue;
    }

    const built = await buildLatexTextPatch({
      snapshot,
      target: resolved.target,
      text: fill.text,
      format: "plain-text",
      summary: `Fill ${label}`,
    });
    if (!built.ok) {
      skipped.push(`${label} (${built.message})`);
      continue;
    }
    const op = built.patchSet.operations[0];
    if (!op || op.op !== "replace_text") {
      skipped.push(label);
      continue;
    }
    stepOps.push(op);
    applied.push(label);
  }

  if (stepOps.length === 0) {
    return {
      ok: false,
      message:
        skipped.length > 0
          ? `Could not apply provided section fills (${skipped.join("; ")}).`
          : "No provided section fills were applied.",
    };
  }

  const operations = await assembleConcurrentReplaceOps(stepOps, snapshot.files);
  const patchSet: PatchSet = {
    schemaVersion: "1",
    id: crypto.randomUUID(),
    projectRevision: snapshot.projectRevision,
    summary: `Fill ${applied.length} manuscript section(s) from user-provided text`,
    operations,
    verify: { compile: true },
  };

  const verified = await simulatePatchSet(snapshot.files, patchSet);
  if (!verified.ok) {
    return {
      ok: false,
      message: `Provided section fill failed validation: ${verified.error.message}`,
    };
  }

  return { ok: true, patchSet, applied, skipped };
}
