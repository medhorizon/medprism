/**
 * Deterministic Plan07.2 routing.
 *
 * The router selects one primary workflow and may attach two fixed stages:
 * optional research before it, and optional LaTeX application after it.
 * This remains a linear product workflow, not a general planner or DAG.
 */
import type { LatexTargetSpec } from "./latex/types";
import type { ResearchPurpose, ResearchSpec } from "./research/types";
import type { WorkflowKind, WorkflowPlan } from "./workflows/types";

export type { WorkflowKind } from "./workflows/types";

export type SkillIntent =
  | "fix-compile"
  | "review"
  | "cite"
  | "polish"
  | "latex"
  | "nature-writing"
  | "write";

/** biomedical → scientific-writing；general → academic-paper */
export type WritingDomain = "biomedical" | "general";

const CNS_RE =
  /\bnature\b|nature communications|nat\.?\s*commun|science magazine|cell press|cell journal|投稿\s*cell|submit(?:ting)?\s+to\s+cell|\bcns\b|子刊|旗舰刊|主投\s*nature|投稿\s*nature/i;
const BIOMED_RE =
  /biomed|biomedical|medicin|medical|clinic|patient|physician|nurs|hospital|surg|diagnos|therap|pharmac|patholog|oncol|cardiol|neuro(?:log|science)|immun|genom|proteom|metabol|epidemi|public health|RCT|randomized|cohort study|case[\s-]control|STROBE|CONSORT|PRISMA|CARE|sepsis|tumor|cancer|diabetes|hypertens|生物医学|医学|临床|患者|病人|医护|医院|诊断|治疗|手术|药理|病理|肿瘤|免疫|基因组|流行病学|队列研究|随机对照|指南/;
const GENERAL_ACADEMIC_RE =
  /非生物医|非医学|通用学术|文科|理工(?!医)|计算机|软件工程|机器学习|深度学习|人工智能|自然语言处理|\bnlp\b|computer vision|\bcvpr\b|\bneurips\b|\bicml\b|\bacl\b|教育[学学]|教育学|经济学|金融学|管理学|社会学|法学|政治学|物理学|天文学|纯数学|应用数学|土木工程|机械工程|材料科学(?!.*clinic)|高等教育|quality assurance.*education|higher education/i;
const FORCE_GENERAL_RE =
  /非生物医|非医学|用\s*academic-paper|academic-paper\s*成文|通用论文|非临床/i;
const FORCE_BIOMED_RE =
  /生物医|临床医学|用\s*scientific-writing|医学论文|临床论文/i;

const COMPILE_RE =
  /compile|编译|tectonic|fix with ai|latex\s*log|undefined control sequence|missing\s+[}\]]|错误日志|编译错误|编译失败/i;
const REVIEW_RE =
  /peer\s*review|referee|manuscript review|editorial (decision|review)|审阅论文|审阅|审稿|评审意见|同行评议|挑毛病|批判性审|模拟审稿|review (this |my )?(paper|manuscript)|critique (this |my )?(paper|manuscript)|帮我审|审查这篇/i;
const CITATION_RE =
  /cite|citation|引用|参考文献|bibtex|pmid|doi|分段引用|补引用|加引用|添加引用|插入引用|找文献(?:支撑|支持)|配文献|支撑文献/i;
const POLISH_RE =
  /润色|polish|proofread|改写|语言润色|学术英语|de-?ai|proof\s*read|language edit/i;
const LATEX_RE =
  /booktabs|换投|venue|格式化|ieee|acm|neurips|overfull|underfull|float too large|伪代码|pseudocode|三线表|表格格式|table\s+format|改\s*格式|调整\s*latex|只.*latex|fix\s*latex|latex\s*format|接(好|入)\s*引用/i;
const RESEARCH_RE =
  /(?:请|帮我|请帮我|麻烦(?:帮我)?|先)?\s*(?:调研|做(?:一份)?(?:文献)?调研|查(?:一)?下(?:资料|文献)?|查资料|检索(?:一下)?(?:相关)?(?:文献)?|搜索(?:一下)?(?:相关)?(?:文献)?|研究一下)|\b(?:research|investigate|literature\s+search|survey\s+the\s+literature|search\s+the\s+literature)\b/i;
/** Natural-language draft/edit intents (not limited to “写/draft”). */
const WRITING_ACTION_RE =
  /写|撰写|起草|生成|准备|拟(?:一份|一个|一段|题|个标题|个题目)?|补充|完善|修改|更新|替换|换成|改成|改为|补上|加上|填上|填入|取(?:个|一个|一下)?(?:标题|题目)|拟题|起名|想(?:个|一个).{0,12}(?:标题|题目)|定(?:个|一个).{0,12}(?:标题|题目)|draft|write|prepare|compose|revise|create|make|generate|propose|suggest/i;
const SELECTION_RE =
  /这段|这句|这句话|选区|所选|selected\s+(?:text|paragraph|sentence)|this\s+(?:paragraph|sentence|selection)/i;

export type WorkflowRouteSource = "ui" | "command" | "rule" | "default";

export type WorkflowRoute = {
  kind: WorkflowKind;
  source: WorkflowRouteSource;
  reason: string;
  reviseProse: boolean;
  plan: WorkflowPlan;
};

export type WorkflowRouteInput = {
  text: string;
  explicitWorkflow?: "auto" | WorkflowKind;
  legacyIntent?: "auto" | SkillIntent | "general";
};

const COMMAND_WORKFLOWS: Array<{ pattern: RegExp; kind: WorkflowKind }> = [
  { pattern: /^\s*\/(?:research|search)\b/i, kind: "research" },
  { pattern: /^\s*\/(?:cite|citation)\b/i, kind: "citation" },
  { pattern: /^\s*\/(?:compile-fix|fix-compile|fix)\b/i, kind: "compile-fix" },
  { pattern: /^\s*\/(?:review|peer-review)\b/i, kind: "review" },
  { pattern: /^\s*\/(?:polish|proofread)\b/i, kind: "polish" },
  { pattern: /^\s*\/(?:latex|format)\b/i, kind: "latex" },
  { pattern: /^\s*\/(?:write|writing|draft|revise)\b/i, kind: "writing" },
];

const TARGET_PATTERNS: Array<{ pattern: RegExp; target: LatexTargetSpec }> = [
  { pattern: /摘要|abstract/i, target: { kind: "abstract", createIfMissing: true } },
  { pattern: /标题|题目|title/i, target: { kind: "title", createIfMissing: true } },
  { pattern: /关键词|关键字|keywords?/i, target: { kind: "keywords", createIfMissing: true } },
  { pattern: /引言|绪论|背景部分|introduction/i, target: { kind: "introduction", createIfMissing: true } },
  { pattern: /材料与方法|患者与方法|研究方法|方法学|方法部分|methods?|methodology|materials?\s+and\s+methods?/i, target: { kind: "methods", createIfMissing: true } },
  { pattern: /结果部分|研究结果|results?/i, target: { kind: "results", createIfMissing: true } },
  { pattern: /讨论部分|discussion/i, target: { kind: "discussion", createIfMissing: true } },
  { pattern: /结论部分|结语|conclusions?/i, target: { kind: "conclusion", createIfMissing: true } },
  { pattern: /基金|资助|funding|financial support/i, target: { kind: "funding", createIfMissing: true } },
  { pattern: /致谢|acknowledg(?:e)?ments?/i, target: { kind: "acknowledgements", createIfMissing: true } },
  { pattern: /作者贡献|作者分工|author contributions?/i, target: { kind: "author-contributions", createIfMissing: true } },
  { pattern: /数据可用性|数据共享|data availability/i, target: { kind: "data-availability", createIfMissing: true } },
  { pattern: /伦理声明|伦理审批|ethics approval|ethical approval/i, target: { kind: "ethics", createIfMissing: true } },
  { pattern: /利益冲突|竞争性利益|conflicts? of interest|competing interests?/i, target: { kind: "conflict-of-interest", createIfMissing: true } },
  { pattern: /正文|主体内容|document body|main body/i, target: { kind: "body", createIfMissing: true } },
];

function cleanResearchTopic(value: string): string {
  return value
    .replace(/^[\s，,]*(?:关于|on|about)\s+/i, "")
    .replace(/[，。！？；：,;:!?()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(?:一下|相关(?:的)?)/, "")
    .replace(/(?:这段|本文|文章|论文|manuscript|this\s+(?:text|paragraph|section))$/i, "")
    .trim();
}

/** Extract an explicit research topic. Empty means “use selectedText”. */
export function extractResearchQuery(text: string): string {
  const original = text.trim();
  const cleaned = original.replace(/[“”"'`]/g, " ").replace(/\s+/g, " ").trim();

  const chineseEmbedded = cleaned.match(
    /(?:写|撰写|起草|生成|准备|完善|修改|润色)(?:一份|一个|一段)?(?:简短|简要|英文|中文|综述式|综述性)?\s*关于\s*(.+?)\s*(?:的)?\s*(?:摘要|引言|方法|结果|讨论|结论|基金|资助|致谢|正文)/i,
  )?.[1];
  if (chineseEmbedded) {
    const topic = cleanResearchTopic(chineseEmbedded);
    if (topic) return topic;
  }

  const englishEmbedded = cleaned.match(
    /(?:write|draft|prepare|compose|revise|polish)\s+(?:an?\s+)?(?:brief\s+|short\s+)?(?:abstract|introduction|methods?|results?|discussion|conclusion|funding|section)\s+(?:on|about)\s+(.+)$/i,
  )?.[1];
  if (englishEmbedded) {
    const topic = cleanResearchTopic(englishEmbedded);
    if (topic) return topic;
  }

  const afterPrefix = cleaned
    .replace(/^\s*\/(?:write|writing|draft|research|search|polish|cite)\b\s*/i, "")
    .replace(
      /^(?:请|帮我|请帮我|麻烦(?:帮我)?|先)?\s*(?:调研(?:一下)?|做(?:一份)?(?:关于)?(?:文献)?调研|查(?:一)?下(?:资料|文献)?|查资料|检索(?:一下)?(?:相关)?(?:文献)?|搜索(?:一下)?(?:相关)?(?:文献)?|研究一下)\s*/i,
      "",
    )
    .replace(
      /^\s*(?:please\s+)?(?:research|investigate|survey|search)(?:\s+the\s+literature)?(?:\s+(?:on|about))?\s+/i,
      "",
    );

  const beforeAction = afterPrefix.split(
    /\s*(?:并|然后|并且|再|and|then)\s*(?:帮我\s*)?(?=写|撰写|起草|生成|准备|完善|修改|润色|改写|补|添加|插入|write|draft|prepare|compose|revise|polish|cite|add)/i,
  )[0] ?? afterPrefix;
  const query = cleanResearchTopic(beforeAction);
  if (/^(?:相关)?(?:文献|资料)?$/i.test(query)) return "";
  return query;
}

export function detectLatexTarget(text: string): LatexTargetSpec | undefined {
  if (SELECTION_RE.test(text)) return { kind: "selection", createIfMissing: false };

  // A research topic containing words such as “methods” must not silently
  // become a manuscript edit. Infer a structural target only for an explicit
  // text-changing request.
  const targetAction =
    WRITING_ACTION_RE.test(text) ||
    POLISH_RE.test(text) ||
    /写入|插入|放入|放到|填充|add\s+to|insert\s+into|put\s+in/i.test(text);
  if (!targetAction) return undefined;

  const known = TARGET_PATTERNS.find((candidate) => candidate.pattern.test(text));
  if (known) return { ...known.target };

  const custom = text.match(
    /(?:写|撰写|起草|生成|完善|修改|润色|write|draft|prepare|compose|revise|polish)(?:一份|一个|一段|\s+an?|\s+the)?\s*[“"']?([^“”"'，。]{2,50})[”"']?\s*(?:部分|章节|section)(?:\s|[，。！？,.!?]|$)/i,
  )?.[1];
  const sectionTitle = custom?.trim();
  return sectionTitle
    ? { kind: "section", sectionTitle, createIfMissing: true }
    : undefined;
}

export function isNatureWritingRequest(text: string): boolean {
  return (
    CNS_RE.test(text) &&
    /写|起草|撰写|draft|write|首稿|投稿|submit|submission|cover letter/i.test(text)
  );
}

export function detectSkillIntent(text: string): SkillIntent {
  const lower = text.toLowerCase();
  if (COMPILE_RE.test(lower)) return "fix-compile";
  if (
    REVIEW_RE.test(lower) ||
    (/^review\b|\breview\b/.test(lower) && /paper|manuscript|稿|论文|article/.test(lower))
  ) {
    return "review";
  }
  if (CITATION_RE.test(lower)) return "cite";
  if (POLISH_RE.test(lower)) return "polish";
  if (LATEX_RE.test(lower)) return "latex";
  if (isNatureWritingRequest(text)) return "nature-writing";
  return "write";
}

export function workflowForIntent(intent: SkillIntent): WorkflowKind {
  switch (intent) {
    case "fix-compile":
      return "compile-fix";
    case "review":
      return "review";
    case "cite":
      return "citation";
    case "polish":
      return "polish";
    case "latex":
      return "latex";
    case "nature-writing":
    case "write":
      return "writing";
  }
}

function researchPurposeFor(kind: WorkflowKind): ResearchPurpose {
  switch (kind) {
    case "citation":
      return "citation";
    case "polish":
      return "polish";
    case "review":
      return "review";
    case "research":
      return "standalone";
    default:
      return "writing";
  }
}

function researchSpecFor(kind: WorkflowKind, text: string): ResearchSpec | undefined {
  if (kind === "compile-fix") return undefined;
  const explicitlyRequested = RESEARCH_RE.test(text) || kind === "research";
  if (kind !== "citation" && !explicitlyRequested) return undefined;
  const query = explicitlyRequested ? extractResearchQuery(text) : "";
  return {
    ...(query ? { query } : {}),
    purpose: researchPurposeFor(kind),
    pageSize: 8,
    requireAbstract: kind === "writing" || kind === "polish",
  };
}

function planFor(kind: WorkflowKind, text: string): WorkflowPlan {
  const research = researchSpecFor(kind, text);
  const target = detectLatexTarget(text);
  const applyToLatex =
    kind === "writing" ||
    kind === "polish" ||
    kind === "citation" ||
    kind === "latex" ||
    kind === "compile-fix";

  const steps: WorkflowPlan["steps"] = [];
  if (research) steps.push("research");
  if (kind !== "research") steps.push(kind);
  if (applyToLatex) steps.push("latex-apply");

  return {
    primary: kind,
    steps,
    ...(research ? { research } : {}),
    ...(target ? { target } : {}),
    applyToLatex,
  };
}

function routeResult(args: {
  kind: WorkflowKind;
  source: WorkflowRouteSource;
  reason: string;
  text: string;
  reviseProse: boolean;
}): WorkflowRoute {
  return {
    kind: args.kind,
    source: args.source,
    reason: args.reason,
    reviseProse: args.kind === "citation" && args.reviseProse,
    plan: planFor(args.kind, args.text),
  };
}

/**
 * Routing priority: explicit UI action → slash command → legacy explicit action
 * → deterministic language rule → safe writing default.
 */
export function routeWorkflow(input: WorkflowRouteInput): WorkflowRoute {
  const text = input.text.trim();
  const reviseProse = CITATION_RE.test(text) && POLISH_RE.test(text);

  if (input.explicitWorkflow && input.explicitWorkflow !== "auto") {
    return routeResult({
      kind: input.explicitWorkflow,
      source: "ui",
      reason: `Explicit UI workflow: ${input.explicitWorkflow}`,
      text,
      reviseProse,
    });
  }

  const command = COMMAND_WORKFLOWS.find((candidate) => candidate.pattern.test(text));
  if (command) {
    return routeResult({
      kind: command.kind,
      source: "command",
      reason: `Explicit command selected ${command.kind}`,
      text,
      reviseProse,
    });
  }

  if (input.legacyIntent && input.legacyIntent !== "auto") {
    const kind = input.legacyIntent === "general"
      ? "writing"
      : workflowForIntent(input.legacyIntent);
    return routeResult({
      kind,
      source: "ui",
      reason: `Legacy explicit intent mapped to ${kind}`,
      text,
      reviseProse,
    });
  }

  const intent = detectSkillIntent(text);
  if (intent !== "write") {
    const kind = workflowForIntent(intent);
    return routeResult({
      kind,
      source: "rule",
      reason: `Rule matched ${intent}`,
      text,
      reviseProse,
    });
  }

  const researchRequested = RESEARCH_RE.test(text);
  const target = detectLatexTarget(text);
  if (researchRequested && !WRITING_ACTION_RE.test(text) && !target) {
    return routeResult({
      kind: "research",
      source: "rule",
      reason: "Standalone research requested",
      text,
      reviseProse: false,
    });
  }

  if (researchRequested || target || WRITING_ACTION_RE.test(text)) {
    return routeResult({
      kind: "writing",
      source: "rule",
      reason: researchRequested
        ? "Research-assisted writing requested"
        : target
          ? "Structured LaTeX writing target requested"
          : "Writing action requested",
      text,
      reviseProse: false,
    });
  }

  return routeResult({
    kind: "writing",
    source: "default",
    reason: "No stronger workflow signal; use writing",
    text,
    reviseProse: false,
  });
}

export function detectWritingDomain(
  text: string,
  projectHint = "",
): WritingDomain {
  const blob = `${text}\n${projectHint}`;

  if (FORCE_GENERAL_RE.test(blob)) return "general";
  if (FORCE_BIOMED_RE.test(blob)) return "biomedical";

  const biomed = BIOMED_RE.test(blob);
  const general = GENERAL_ACADEMIC_RE.test(blob);

  if (general && !biomed) return "general";
  if (biomed) return "biomedical";
  if (general) return "general";
  return "biomedical";
}

export function contentSkillForDomain(domain: WritingDomain): string {
  return domain === "general" ? "academic-paper" : "scientific-writing";
}

/** Compatibility API retained until remaining external callers migrate. */
export function skillIdsForIntent(
  intent: SkillIntent,
  text = "",
  projectHint = "",
): string[] {
  const domain = detectWritingDomain(text, projectHint);
  const content = contentSkillForDomain(domain);

  switch (intent) {
    case "fix-compile":
      return ["fix-compile-errors"];
    case "review":
      return ["academic-paper-reviewer"];
    case "cite":
      return ["nature-citation"];
    case "polish":
      return ["nature-polishing"];
    case "latex":
      return ["latex-paper-en"];
    case "nature-writing":
      return ["nature-writing"];
    case "write":
      return [content];
  }
}
