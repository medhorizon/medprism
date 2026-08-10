import type { LatexTargetKind, LatexTargetSpec } from "./types";

/** Fallback when the user asks for a blank scaffold but lists no modules. */
export const DEFAULT_SUBMISSION_SCAFFOLD: LatexTargetSpec[] = [
  { kind: "keywords", createIfMissing: true },
  { kind: "funding", createIfMissing: true },
  { kind: "conflict-of-interest", createIfMissing: true },
  { kind: "ethics", createIfMissing: true },
  {
    kind: "section",
    sectionTitle: "Consent for publication",
    createIfMissing: true,
  },
  { kind: "data-availability", createIfMissing: true },
  {
    kind: "section",
    sectionTitle: "Materials availability",
    createIfMissing: true,
  },
  {
    kind: "section",
    sectionTitle: "Code availability",
    createIfMissing: true,
  },
  { kind: "author-contributions", createIfMissing: true },
  {
    kind: "section",
    sectionTitle: "Supplementary Information",
    createIfMissing: true,
  },
];

/** Known structural targets the runtime can materialize as empty shells. */
const KIND_PATTERNS: Array<{ pattern: RegExp; kind: LatexTargetKind }> = [
  { pattern: /\bkeywords?\b|关键词|关键字/i, kind: "keywords" },
  { pattern: /\babstract\b|摘要/i, kind: "abstract" },
  // Avoid matching 标题页 / title page (non-shell checklist rows).
  { pattern: /\btitle\b(?!\s*page)|(?<!页)标题(?!页)|题目/i, kind: "title" },
  { pattern: /\bintroduction\b|引言|绪论/i, kind: "introduction" },
  {
    pattern:
      /\bmethods?\b|\bmethodology\b|材料与方法|患者与方法|研究方法|方法学|方法部分/i,
    kind: "methods",
  },
  { pattern: /\bresults?\b|结果部分|研究结果/i, kind: "results" },
  { pattern: /\bdiscussion\b|讨论部分/i, kind: "discussion" },
  { pattern: /\bconclusions?\b|结论部分|结语/i, kind: "conclusion" },
  { pattern: /\bfunding\b|financial support|基金|资助/i, kind: "funding" },
  {
    pattern: /\backnowledg(?:e)?ments?\b|致谢/i,
    kind: "acknowledgements",
  },
  {
    pattern: /\bauthor contributions?\b|作者贡献|作者分工/i,
    kind: "author-contributions",
  },
  {
    pattern: /\bdata availability\b|数据可用性|数据共享/i,
    kind: "data-availability",
  },
  {
    pattern: /\bethics approval\b|\bethical approval\b|伦理声明|伦理审批/i,
    kind: "ethics",
  },
  {
    pattern:
      /\bconflicts? of interest\b|\bcompeting interests?\b|利益冲突|竞争性利益/i,
    kind: "conflict-of-interest",
  },
];

/** Named custom sections commonly requested in journal checklists. */
const NAMED_SECTION_PATTERNS: Array<{ pattern: RegExp; sectionTitle: string }> = [
  {
    pattern: /consent for publication|发表同意|出版同意/i,
    sectionTitle: "Consent for publication",
  },
  {
    pattern: /materials? availability|材料可用性/i,
    sectionTitle: "Materials availability",
  },
  {
    pattern: /code availability|代码可用性/i,
    sectionTitle: "Code availability",
  },
  {
    pattern: /supplementary information|补充材料|补充信息|supporting information/i,
    sectionTitle: "Supplementary Information",
  },
];

/** Checklist rows that are not empty LaTeX prose shells. */
const SKIP_ITEM_RE =
  /^(?:参考文献|references?|bibliography|图表|figures?|tables?|图片|表格|标题页|title\s*page|cover\s*letter|投稿信|正文|主体|声明部分|declarations?)$/i;

const BLANK_HINT_RE =
  /空壳|留白|占位|内容留空|内容为空|暂时(?:为|未)?空白|先留白|blank(?:\s+shells?)?|empty\s+(?:shells?|sections?|modules?)|placeholder/i;

export type ScaffoldModuleParseResult = {
  modules: LatexTargetSpec[];
  /** Where the module list came from. */
  source: "checklist" | "mentions" | "default";
  /** Checklist fragments ignored (non-shell or unrecognized). */
  ignored: string[];
};

function specKey(spec: LatexTargetSpec): string {
  if (spec.kind === "section") {
    return `section:${(spec.sectionTitle ?? "").trim().toLowerCase()}`;
  }
  return spec.kind;
}

function pushUnique(out: LatexTargetSpec[], spec: LatexTargetSpec, seen: Set<string>) {
  const key = specKey(spec);
  if (!key || key === "section:" || seen.has(key)) return;
  if (spec.kind === "selection" || spec.kind === "body") return;
  seen.add(key);
  out.push({ ...spec, createIfMissing: true });
}

function specsFromFragment(fragment: string): LatexTargetSpec[] {
  const found: LatexTargetSpec[] = [];
  const seen = new Set<string>();
  for (const entry of KIND_PATTERNS) {
    if (entry.pattern.test(fragment)) {
      pushUnique(found, { kind: entry.kind, createIfMissing: true }, seen);
    }
  }
  for (const entry of NAMED_SECTION_PATTERNS) {
    if (entry.pattern.test(fragment)) {
      pushUnique(
        found,
        {
          kind: "section",
          sectionTitle: entry.sectionTitle,
          createIfMissing: true,
        },
        seen,
      );
    }
  }
  return found;
}

/** Split a checklist row that packs several labels into one line. */
function splitPackedLabels(item: string): string[] {
  const parts = item
    .split(/(?:[,，;；、|/]|(?<=[a-z])(?=[A-Z])|\s{2,})/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [item.trim()];
}

function extractChecklistItems(text: string): string[] {
  const items: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const numbered = line.match(/^\s*(?:\d+[\.\)、]\s+|[-*•]\s+)(.+?)\s*$/);
    if (numbered?.[1]) {
      items.push(numbered[1].trim());
      continue;
    }
  }
  if (items.length >= 1) return items;

  // Inline list after an explicit colon cue: "搭骨架：Funding、Ethics、Data availability"
  const afterColon = text.match(
    /(?:搭(?:建)?骨架|准备(?:一下)?(?:模块|结构)|空壳|留白|清单|modules?)[^：:\n]{0,24}[：:]\s*([^\n]{3,240})$/im,
  )?.[1];
  if (afterColon) {
    const parts = afterColon
      .split(/[,，;；、|]/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2 && part.length <= 80);
    if (parts.length >= 2) return parts;
  }
  return [];
}

function cleanCustomTitle(raw: string): string | null {
  const title = raw
    .replace(/^(?:请|帮我|写|撰写|准备|添加|插入|补上|补齐)\s*/i, "")
    .replace(/(?:部分|章节|section|模块|空壳|占位|留白)$/i, "")
    .replace(/[（(].*?[）)]/g, "")
    .trim();
  if (title.length < 2 || title.length > 60) return null;
  if (SKIP_ITEM_RE.test(title)) return null;
  if (/^[\d\W_]+$/u.test(title)) return null;
  // Avoid turning whole sentences into section titles.
  if (/[。？！?!]/.test(title) || /\s{3,}/.test(title)) return null;
  return title;
}

/**
 * Parse which empty LaTeX shells the user asked for.
 * Prefers explicit checklist rows; otherwise scans targetKind mentions;
 * falls back to DEFAULT_SUBMISSION_SCAFFOLD when nothing concrete is listed.
 */
export function parseScaffoldModules(userText: string): ScaffoldModuleParseResult {
  const text = userText.replace(/\r\n?/g, "\n").trim();
  const modules: LatexTargetSpec[] = [];
  const ignored: string[] = [];
  const seen = new Set<string>();

  const checklist = extractChecklistItems(text);
  if (checklist.length > 0) {
    for (const item of checklist) {
      const fragments = splitPackedLabels(item);
      let matched = false;
      for (const fragment of fragments) {
        if (SKIP_ITEM_RE.test(fragment)) {
          ignored.push(fragment);
          continue;
        }
        const fromKnown = specsFromFragment(fragment);
        if (fromKnown.length > 0) {
          for (const spec of fromKnown) pushUnique(modules, spec, seen);
          matched = true;
          continue;
        }
        // Whole packed line may still contain known labels even if fragments don't.
      }
      if (!matched) {
        if (SKIP_ITEM_RE.test(item.trim())) {
          ignored.push(item.trim());
          continue;
        }
        const fromItem = specsFromFragment(item);
        if (fromItem.length > 0) {
          for (const spec of fromItem) pushUnique(modules, spec, seen);
          matched = true;
        }
      }
      if (!matched) {
        const custom = cleanCustomTitle(item);
        if (custom) {
          pushUnique(
            modules,
            { kind: "section", sectionTitle: custom, createIfMissing: true },
            seen,
          );
        } else {
          ignored.push(item.trim());
        }
      }
    }
    if (modules.length > 0) {
      return { modules, source: "checklist", ignored };
    }
  }

  // No usable checklist — collect every mentioned kind / named section in text order.
  const mentionHits: Array<{ index: number; spec: LatexTargetSpec }> = [];
  for (const entry of KIND_PATTERNS) {
    const match = entry.pattern.exec(text);
    if (match && match.index >= 0) {
      mentionHits.push({
        index: match.index,
        spec: { kind: entry.kind, createIfMissing: true },
      });
    }
  }
  for (const entry of NAMED_SECTION_PATTERNS) {
    const match = entry.pattern.exec(text);
    if (match && match.index >= 0) {
      mentionHits.push({
        index: match.index,
        spec: {
          kind: "section",
          sectionTitle: entry.sectionTitle,
          createIfMissing: true,
        },
      });
    }
  }
  mentionHits.sort((a, b) => a.index - b.index);
  for (const hit of mentionHits) pushUnique(modules, hit.spec, seen);

  if (modules.length > 0) {
    return { modules, source: "mentions", ignored };
  }

  return {
    modules: DEFAULT_SUBMISSION_SCAFFOLD.map((spec) => ({ ...spec })),
    source: "default",
    ignored,
  };
}

/** True when the user is asking for blank structural shells (possibly with a custom list). */
export function isBlankScaffoldIntent(text: string): boolean {
  const parsed = parseScaffoldModules(text);
  if (BLANK_HINT_RE.test(text) && parsed.modules.length >= 1) return true;
  if (
    parsed.source === "checklist" &&
    parsed.modules.length >= 2 &&
    /准备|搭建|写入|插入|补齐|添加|insert|add|prepare|scaffold/i.test(text)
  ) {
    return true;
  }
  return false;
}
