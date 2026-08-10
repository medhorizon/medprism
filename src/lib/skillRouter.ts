/**
 * Deterministic Plan07.2 routing.
 *
 * The router selects one primary workflow and may attach two fixed stages:
 * optional research before it, and optional LaTeX application after it.
 * This remains a linear product workflow, not a general planner or DAG.
 */
import { isBlankScaffoldIntent } from "./latex/scaffoldModules";
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
/** True citation actions — not checklist mentions of “参考文献” in submission prep. */
const CITATION_RE =
  /(?:\bcite\b|\bcitation\b|分段引用|补引用|加引用|添加引用|插入引用|找文献(?:支撑|支持)|配文献|支撑文献|(?:补|加|插入|添加)\s*(?:一下|几个|两篇|几篇)?\s*(?:引用|参考文献)|(?:引用|参考文献).{0,8}(?:补|加|插入|添加)|bibtex|\bpmid\b|\bdoi\b)/i;
const POLISH_RE =
  /润色|polish|proofread|改写|语言润色|学术英语|de-?ai|proof\s*read|language edit/i;
const LATEX_RE =
  /booktabs|换投|venue|格式化|ieee|acm|neurips|overfull|underfull|float too large|伪代码|pseudocode|三线表|表格格式|table\s+format|改\s*格式|调整\s*latex|只.*latex|fix\s*latex|latex\s*format|接(好|入)\s*引用/i;
const RESEARCH_RE =
  /(?:请|帮我|请帮我|麻烦(?:帮我)?|先)?\s*(?:调研|做(?:一份)?(?:文献)?调研|查(?:一)?下(?:资料|文献)?|查资料|检索(?:一下)?(?:相关)?(?:文献)?|搜索(?:一下)?(?:相关)?(?:文献)?|研究一下)|\b(?:research|investigate|literature\s+search|survey\s+the\s+literature|search\s+the\s+literature)\b/i;
/** Natural-language draft/edit intents (not limited to “写/draft”). */
const WRITING_ACTION_RE =
  /写|撰写|起草|生成|准备|拟(?:一份|一个|一段|题|个标题|个题目)?|补充|完善|修改|更新|替换|换成|改成|改为|补上|加上|填上|填入|取(?:个|一个|一下)?(?:标题|题目)|拟题|起名|想(?:个|一个).{0,12}(?:标题|题目)|定(?:个|一个).{0,12}(?:标题|题目)|draft|write|prepare|compose|revise|create|make|generate|propose|suggest/i;
/** Multi-block blank scaffolds / submission checklists — writing, not citation/research. */
const STRUCTURAL_SCAFFOLD_RE =
  /准备(?:一下)?(?:模块|结构|框架|骨架|声明)|(?:这些)?模块(?:作为|写入)|(?:作为\s*)?LaTeX\s*结构|搭(?:建)?骨架|结构写入|检查结构|补(?:齐|上|充)?结构|(?:内容|正文)?(?:暂时|先)?(?:为|设为|设置|未)?(?:空白|留空)|内容留空|先留白|留白占位|空壳|占位(?:符|块|段)?|投稿(?:前)?(?:材料|清单|要件)|声明部分|补充材料|title page|author guidelines|(?:准备|搭建|补齐).{0,24}scientific reports/i;
const SELECTION_RE =
  /这段|这句|这句话|选区|所选|selected\s+(?:text|paragraph|sentence)|this\s+(?:paragraph|sentence|selection)/i;

export function isStructuralScaffoldRequest(text: string): boolean {
  const writingish =
    WRITING_ACTION_RE.test(text) || /写入|插入|insert\b|add\b/i.test(text);
  if (STRUCTURAL_SCAFFOLD_RE.test(text) && writingish) return true;
  // Blank multi-module inserts with an explicit checklist / targetKind list.
  return writingish && isBlankScaffoldIntent(text);
}

export type WorkflowRouteSource = "ui" | "command" | "rule" | "default" | "llm";

export type WorkflowRoute = {
  kind: WorkflowKind;
  source: WorkflowRouteSource;
  reason: string;
  reviseProse: boolean;
  plan: WorkflowPlan;
  /** When true, runtime should ask the closed-set LLM classifier before executing. */
  needsLlmClassification?: boolean;
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
  { pattern: /^\s*\/(?:ask|advice|help)\b/i, kind: "advice" },
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
    CITATION_RE.test(text) ||
    /写入|插入|放入|放到|填充|增加引用|补引用|add\s+to|insert\s+into|put\s+in/i.test(text);
  if (!targetAction) return undefined;

  // Multi-block scaffold / submission checklists must not collapse to one target
  // (e.g. first hit “摘要”) — let writing emit multiple structural inserts instead.
  if (isStructuralScaffoldRequest(text)) return undefined;

  const knownMatches = TARGET_PATTERNS.filter((candidate) => candidate.pattern.test(text));
  const uniqueKinds = new Set(knownMatches.map((match) => match.target.kind));
  // Long requirement lists without an explicit single-section verb are multi-target.
  // Provided multi-section pastes are applied by runtime section-fill, not this target.
  if (uniqueKinds.size >= 3) return undefined;
  const known = knownMatches[0];
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
  // Blank-module / submission-checklist prep is writing even if the list mentions references.
  if (isStructuralScaffoldRequest(text)) return "write";
  if (CITATION_RE.test(text)) return "cite";
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
  if (kind === "compile-fix" || kind === "advice") return undefined;
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
  if (kind === "advice") {
    return {
      primary: "advice",
      steps: ["advice"],
      applyToLatex: false,
    };
  }

  const research = researchSpecFor(kind, text);
  const target =
    kind === "research" || kind === "review" ? undefined : detectLatexTarget(text);
  const applyToLatex =
    kind === "writing" ||
    kind === "polish" ||
    kind === "citation" ||
    kind === "latex" ||
    kind === "compile-fix";

  const steps: WorkflowPlan["steps"] = [];
  if (kind === "research") {
    steps.push("research");
  } else {
    if (research) steps.push("research");
    steps.push(kind);
    if (applyToLatex) steps.push("latex-apply");
  }

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
  needsLlmClassification?: boolean;
}): WorkflowRoute {
  return {
    kind: args.kind,
    source: args.source,
    reason: args.reason,
    reviseProse: args.kind === "citation" && args.reviseProse,
    plan: planFor(args.kind, args.text),
    ...(args.needsLlmClassification ? { needsLlmClassification: true } : {}),
  };
}

/**
 * Routing priority: explicit UI → slash command → legacy intent →
 * LLM closed-set classification for all other natural-language turns.
 *
 * Regex helpers still shape the *plan* (targets, research, blank-scaffold detection)
 * after a kind is chosen. Runtime may override the handler for blank scaffolds
 * without skipping the classifier (see `applyRuntimeScaffoldGuard`).
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

  return routeResult({
    kind: "advice",
    source: "default",
    reason: "Natural-language request pending LLM classification",
    text,
    reviseProse: false,
    needsLlmClassification: true,
  });
}

/**
 * After LLM (or provisional) routing: blank-shell requests always execute as
 * writing + runtime scaffold. Does not override explicit UI / slash commands.
 */
export function applyRuntimeScaffoldGuard(args: {
  route: WorkflowRoute;
  userText: string;
  /** True when the user/UI/command already locked the workflow. */
  locked: boolean;
}): { route: WorkflowRoute; overridden: boolean; fromKind: WorkflowKind } {
  const fromKind = args.route.kind;
  if (args.locked || !isStructuralScaffoldRequest(args.userText)) {
    return { route: args.route, overridden: false, fromKind };
  }
  if (fromKind === "writing" && args.route.plan.applyToLatex) {
    return { route: args.route, overridden: false, fromKind };
  }
  return {
    route: routeWorkflow({
      text: args.userText,
      explicitWorkflow: "writing",
    }),
    overridden: true,
    fromKind,
  };
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
