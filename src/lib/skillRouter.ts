/**
 * Plan6 skill routing (user-confirmed division of labor):
 * - scientific-writing → 生物医学成文
 * - academic-paper → 非生物医学成文（入口）
 * - nature-citation → 只生成 citation
 * - latex-paper-en → 只改格式 / 把 citation 接入 LaTeX（不改科学内容）
 * - academic-paper-reviewer → 审稿 / 同行评议报告
 */

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
  /\bnature\b|nature communications|nat\.?\s*commun|science magazine|\bcell\b|cell press|\bcns\b|子刊|旗舰刊|主投\s*nature|投稿\s*nature/i;

/** Strong biomedical / clinical signals */
const BIOMED_RE =
  /biomed|biomedical|medicin|medical|clinic|patient|physician|nurs|hospital|surg|diagnos|therap|pharmac|patholog|oncol|cardiol|neuro(?:log|science)|immun|genom|proteom|metabol|epidemi|public health|RCT|randomized|cohort study|case[\s-]control|STROBE|CONSORT|PRISMA|CARE|sepsis|tumor|cancer|diabetes|hypertens|生物医学|医学|临床|患者|病人|医护|医院|诊断|治疗|手术|药理|病理|肿瘤|免疫|基因组|流行病学|队列研究|随机对照|指南/;

/**
 * Explicit non-biomed / general-academic entry.
 * Prefer these over weak biomed false-positives when user opts out.
 */
const GENERAL_ACADEMIC_RE =
  /非生物医|非医学|通用学术|文科|理工(?!医)|计算机|软件工程|机器学习|深度学习|人工智能|自然语言处理|\bnlp\b|computer vision|\bcvpr\b|\bneurips\b|\bicml\b|\bacl\b|教育[学学]|教育学|经济学|金融学|管理学|社会学|法学|政治学|物理学|天文学|纯数学|应用数学|土木工程|机械工程|材料科学(?!.*clinic)|高等教育|quality assurance.*education|higher education/i;

const FORCE_GENERAL_RE =
  /非生物医|非医学|用\s*academic-paper|academic-paper\s*成文|通用论文|非临床/i;

const FORCE_BIOMED_RE =
  /生物医|临床医学|用\s*scientific-writing|医学论文|临床论文/i;

export function detectSkillIntent(text: string): SkillIntent {
  const lower = text.toLowerCase();

  if (
    /compile|编译|tectonic|fix with ai|latex\s*log|overfull|underfull|undefined control sequence|错误日志/.test(
      lower,
    )
  ) {
    return "fix-compile";
  }

  if (
    CNS_RE.test(text) &&
    /写|draft|write|首稿|manuscript|投稿|submission|abstract|introduction|cover letter/.test(
      lower,
    )
  ) {
    return "nature-writing";
  }

  // Peer review / critique (before cite: "review citations" still can hit cite if stronger)
  if (
    /peer\s*review|referee|manuscript review|editorial (decision|review)|审阅论文|审阅|审稿|评审意见|同行评议|挑毛病|批判性审|模拟审稿|review (this |my )?(paper|manuscript)|critique (this |my )?(paper|manuscript)|帮我审|审查这篇/.test(
      lower,
    ) ||
    (/^review\b|\breview\b/.test(lower) &&
      /paper|manuscript|稿|论文|article/.test(lower))
  ) {
    return "review";
  }

  if (
    /cite|citation|引用|参考文献|bibtex|pubmed|pmid|doi|literature|分段引用|补引用|找文献|配文献|支撑文献/.test(
      lower,
    )
  ) {
    return "cite";
  }

  if (
    /润色|polish|proofread|改写|语言润色|学术英语|de-?ai|proof\s*read|language edit/.test(
      lower,
    )
  ) {
    return "polish";
  }

  if (
    /booktabs|换投|venue|格式化|ieee|acm|neurips|overfull|float too large|伪代码|pseudocode|三线表|改\s*格式|改\s*latex|fix\s*latex|latex\s*format|插入\s*cite|接(好|入)\s*引用/.test(
      lower,
    )
  ) {
    return "latex";
  }

  return "write";
}

/**
 * Domain entry for content skills.
 * - Force phrases win first.
 * - Else biomedical keywords → biomedical.
 * - Else general-academic keywords → general.
 * - Default (MedPrism) → biomedical.
 */
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

  // Product default: medical workspace
  return "biomedical";
}

/** Content skill id for the writing stack */
export function contentSkillForDomain(domain: WritingDomain): string {
  return domain === "general" ? "academic-paper" : "scientific-writing";
}

/** Active skill ids for a resolved intent (+ domain for write paths) */
export function skillIdsForIntent(
  intent: SkillIntent,
  text = "",
  projectHint = "",
): string[] {
  const domain = detectWritingDomain(text, projectHint);
  const content = contentSkillForDomain(domain);

  switch (intent) {
    case "fix-compile":
      return ["fix-compile-errors", "latex-paper-en"];
    case "review":
      return ["academic-paper-reviewer"];
    case "cite":
      return ["nature-citation", "latex-paper-en"];
    case "polish":
      return ["nature-polishing"];
    case "latex":
      return ["latex-paper-en"];
    case "nature-writing":
      return ["nature-writing", content];
    case "write":
    default:
      return [content];
  }
}
