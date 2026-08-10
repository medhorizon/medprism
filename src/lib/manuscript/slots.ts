import type {
  ManuscriptSlotKind,
  ManuscriptSlotRef,
} from "./types";

type SlotDefinition = {
  slot: ManuscriptSlotKind;
  heading: string;
  family: "front" | "main" | "back" | "other";
  aliases: string[];
};

export const SLOT_DEFINITIONS: readonly SlotDefinition[] = [
  { slot: "title", heading: "Title", family: "front", aliases: ["title", "标题", "题目"] },
  { slot: "abstract", heading: "Abstract", family: "front", aliases: ["abstract", "摘要"] },
  { slot: "keywords", heading: "Keywords", family: "front", aliases: ["keywords", "keyword", "关键词", "关键字"] },
  { slot: "introduction", heading: "Introduction", family: "main", aliases: ["introduction", "background", "引言", "绪论"] },
  { slot: "methods", heading: "Methods", family: "main", aliases: ["materials and methods", "patients and methods", "methodology", "methods", "method", "材料与方法", "研究方法", "方法学", "方法"] },
  { slot: "results", heading: "Results", family: "main", aliases: ["results", "result", "结果"] },
  { slot: "discussion", heading: "Discussion", family: "main", aliases: ["discussion", "讨论"] },
  { slot: "conclusion", heading: "Conclusion", family: "main", aliases: ["conclusions", "conclusion", "结论", "结语"] },
  { slot: "acknowledgements", heading: "Acknowledgements", family: "back", aliases: ["acknowledgements", "acknowledgments", "acknowledgement", "acknowledgment", "致谢"] },
  { slot: "funding", heading: "Funding", family: "back", aliases: ["funding information", "financial support", "funding", "基金", "资助"] },
  { slot: "author-contributions", heading: "Author contributions", family: "back", aliases: ["author contributions", "authors contributions", "author contribution", "作者贡献", "作者分工"] },
  { slot: "competing-interests", heading: "Competing interests", family: "back", aliases: ["conflict of interest", "conflicts of interest", "competing interests", "利益冲突", "竞争性利益"] },
  { slot: "ethics", heading: "Ethics approval and consent to participate", family: "back", aliases: ["ethics approval and consent to participate", "ethics approval", "ethical approval", "ethics statement", "ethics", "伦理声明", "伦理审批", "伦理部分", "伦理"] },
  { slot: "consent-publication", heading: "Consent for publication", family: "back", aliases: ["consent for publication", "发表同意", "出版同意"] },
  { slot: "data-availability", heading: "Data availability", family: "back", aliases: ["data availability", "availability of data", "数据可用性", "数据共享"] },
  { slot: "materials-availability", heading: "Materials availability", family: "back", aliases: ["materials availability", "material availability", "材料可用性"] },
  { slot: "code-availability", heading: "Code availability", family: "back", aliases: ["code availability", "代码可用性"] },
  { slot: "supplementary-information", heading: "Supplementary Information", family: "back", aliases: ["supplementary information", "supporting information", "补充材料", "补充信息"] },
  { slot: "body", heading: "Body", family: "other", aliases: ["main body", "document body", "正文", "主体内容"] },
] as const;

export const MANUSCRIPT_SLOT_KINDS = new Set<ManuscriptSlotKind>(
  SLOT_DEFINITIONS.map((definition) => definition.slot),
);

export function normalizeHeading(value: string): string {
  return value
    .replace(/\\[A-Za-z@]+\*?(?:\[[^\]]*\])?/g, " ")
    .replace(/[{}~*_]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function slotKey(ref: ManuscriptSlotRef): string {
  return ref.slot === "custom-section"
    ? `custom:${normalizeHeading(ref.title)}`
    : ref.slot;
}

export function displayHeading(ref: ManuscriptSlotRef): string {
  if (ref.slot === "custom-section") return ref.title.trim() || "Section";
  return SLOT_DEFINITIONS.find((definition) => definition.slot === ref.slot)?.heading ?? ref.slot;
}

export function slotFamily(ref: ManuscriptSlotRef): SlotDefinition["family"] {
  if (ref.slot === "custom-section") return "main";
  return SLOT_DEFINITIONS.find((definition) => definition.slot === ref.slot)?.family ?? "other";
}

export function matchHeading(value: string): ManuscriptSlotRef {
  const normalized = normalizeHeading(value);
  let best: { definition: SlotDefinition; score: number } | null = null;
  for (const definition of SLOT_DEFINITIONS) {
    for (const alias of definition.aliases) {
      const needle = normalizeHeading(alias);
      const matches =
        normalized === needle ||
        (needle.length >= 5 && normalized.includes(needle));
      if (!matches) continue;
      if (!best || needle.length > best.score) best = { definition, score: needle.length };
    }
  }
  return best
    ? { slot: best.definition.slot }
    : { slot: "custom-section", title: value.trim() || "Section" };
}

export function isBackmatter(ref: ManuscriptSlotRef): boolean {
  return slotFamily(ref) === "back";
}

export function slotOrder(ref: ManuscriptSlotRef): number {
  const index = SLOT_DEFINITIONS.findIndex((definition) => definition.slot === ref.slot);
  return index < 0 ? SLOT_DEFINITIONS.length : index;
}
