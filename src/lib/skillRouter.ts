/**
 * Deterministic Plan07 routing.
 *
 * Product workflows are stable business actions. Markdown Skill files are
 * implementation guidance selected later by the workflow handler.
 */
import type { WorkflowKind } from "./workflows/types";

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

/** Strong biomedical / clinical signals */
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
  /cite|citation|引用|参考文献|bibtex|pubmed|pmid|doi|literature|分段引用|补引用|找文献|配文献|支撑文献/i;
const POLISH_RE =
  /润色|polish|proofread|改写|语言润色|学术英语|de-?ai|proof\s*read|language edit/i;
const LATEX_RE =
  /booktabs|换投|venue|格式化|ieee|acm|neurips|overfull|underfull|float too large|伪代码|pseudocode|三线表|表格格式|table\s+format|改\s*格式|调整\s*latex|只.*latex|fix\s*latex|latex\s*format|插入\s*cite|接(好|入)\s*引用/i;

export type WorkflowRouteSource = "ui" | "command" | "rule" | "default";

export type WorkflowRoute = {
  kind: WorkflowKind;
  source: WorkflowRouteSource;
  reason: string;
  reviseProse: boolean;
};

export type WorkflowRouteInput = {
  text: string;
  explicitWorkflow?: "auto" | WorkflowKind;
  legacyIntent?: "auto" | SkillIntent | "general";
};

const COMMAND_WORKFLOWS: Array<{ pattern: RegExp; kind: WorkflowKind }> = [
  { pattern: /^\s*\/(?:cite|citation)\b/i, kind: "citation" },
  { pattern: /^\s*\/(?:compile-fix|fix-compile|fix)\b/i, kind: "compile-fix" },
  { pattern: /^\s*\/(?:review|peer-review)\b/i, kind: "review" },
  { pattern: /^\s*\/(?:polish|proofread)\b/i, kind: "polish" },
  { pattern: /^\s*\/(?:latex|format)\b/i, kind: "latex" },
  { pattern: /^\s*\/(?:write|writing|draft|revise)\b/i, kind: "writing" },
];

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

/**
 * Routing priority: explicit UI action → slash command → legacy explicit action
 * → deterministic language rule → safe writing default.
 */
export function routeWorkflow(input: WorkflowRouteInput): WorkflowRoute {
  const text = input.text.trim();
  const reviseProse = CITATION_RE.test(text) && POLISH_RE.test(text);

  if (input.explicitWorkflow && input.explicitWorkflow !== "auto") {
    return {
      kind: input.explicitWorkflow,
      source: "ui",
      reason: `Explicit UI workflow: ${input.explicitWorkflow}`,
      reviseProse: input.explicitWorkflow === "citation" && reviseProse,
    };
  }

  const command = COMMAND_WORKFLOWS.find((candidate) => candidate.pattern.test(text));
  if (command) {
    return {
      kind: command.kind,
      source: "command",
      reason: `Explicit command selected ${command.kind}`,
      reviseProse: command.kind === "citation" && reviseProse,
    };
  }

  if (input.legacyIntent && input.legacyIntent !== "auto") {
    const kind = input.legacyIntent === "general"
      ? "writing"
      : workflowForIntent(input.legacyIntent);
    return {
      kind,
      source: "ui",
      reason: `Legacy explicit intent mapped to ${kind}`,
      reviseProse: kind === "citation" && reviseProse,
    };
  }

  const intent = detectSkillIntent(text);
  const kind = workflowForIntent(intent);
  return {
    kind,
    source: intent === "write" ? "default" : "rule",
    reason: intent === "write" ? "No stronger workflow signal; use writing" : `Rule matched ${intent}`,
    reviseProse: kind === "citation" && reviseProse,
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
