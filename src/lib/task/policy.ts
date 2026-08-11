import type { ConversationArtifact } from "../../types/chat";
import type { ManuscriptSlotKind } from "../manuscript/types";
import type {
  SuccessfulInterpretedTask,
  TaskAction,
  TaskApplyMode,
  TaskContentMode,
  TaskScope,
  TaskSpec,
  TaskTarget,
} from "./types";

const ANSWER_ONLY_ACTIONS = new Set<TaskAction>(["advice", "review", "research"]);

const COMMIT_SPEECH_RE =
  /(?:修改|替换|更新|写入|插入|填入|采用|使用(?:上面|刚才|第)|用(?:上面|刚才|第|这个|那个)|定稿为|改为|改成|换成|设为|应用(?:这个|上述)|change\s+.+\s+to|replace\s+.+\s+with|set\s+.+\s+to|insert\s+.+\s+into|apply\s+(?:this|the)|use\s+(?:the|this|that).+\b(?:title|text|version)|write\s+.+\s+into)/i;

const EXPLORATORY_SPEECH_RE =
  /(?:如何|怎么|怎样|有什么建议|只(?:检查|分析|审阅|给建议)|检查但不修改|不(?:要|需|需要|用)(?:修改|改动|写入)|给.*(?:几个|一些).*(?:候选|备选)|帮我.*(?:取|想|拟).*(?:标题|题目)|(?:英文|中文)?改写(?:一下)?(?:这个|以下|上述)?(?:标题|题目)|翻译(?:一下)?(?:这个|以下|上述)?(?:标题|题目)|是否应该|可以吗|without\s+(?:modifying|changing|editing)|do\s+not\s+(?:modify|change|edit)|no\s+(?:file\s+)?changes?|how\s+(?:should|can|do)|what\s+(?:would|should)|suggest|propose\s+(?:some|a few)|ideas?\s+for|rewrite\s+(?:this|the)\s+title|translate\s+(?:this|the)\s+title)/i;

const EXPLICIT_ASSIGNMENT_RE =
  /(?:修改|替换|更新|改写|定稿|设置).{0,32}?(?:为|成)\s*\S|(?:change|replace|rewrite|set|update)\s+.+?\s+(?:to|with|as)\s+\S/i;
const HISTORY_REFERENCE_RE =
  /(?:刚才|上面|上述|前面|第\s*[一二三四五六七八九十\d]+\s*个?|previous|above|earlier|the\s+(?:first|second|third|fourth|fifth))/i;
const WRITING_ASSIST_RE =
  /(?:协助写作|辅助写作|论文写作|科研写作|学术写作|SCI\s*写作|(?:帮我|请|please).{0,24}(?:写|撰写|起草|生成|补充|扩写|续写|完善|润色|改写|重写|翻译|整合|优化|学术化)|(?:写|撰写|起草|生成|补充|扩写|续写|完善|润色|改写|重写|翻译|整合|优化|学术化).{0,40}(?:标题|题目|摘要|引言|方法|结果|讨论|结论|关键词|声明|章节|正文|全文|文章|稿件|论文)|(?:write|draft|generate|compose|expand|continue|complete|polish|rewrite|rephrase|translate|improve|optimise|optimize).{0,80}\b(?:title|abstract|introduction|methods?|results?|discussion|conclusion|keywords?|statement|section|manuscript|paper)\b|\b(?:academic|scientific)\s+writing\b)/i;

const SLOT_PATTERNS: ReadonlyArray<[ManuscriptSlotKind, RegExp]> = [
  ["title", /标题|题目|\btitle\b/i],
  ["abstract", /摘要|\babstract\b/i],
  ["keywords", /关键词|关键字|\bkeywords?\b/i],
  ["introduction", /引言|绪论|\bintroduction\b/i],
  ["methods", /方法|材料与方法|\bmethods?\b/i],
  ["results", /结果|\bresults?\b/i],
  ["discussion", /讨论|\bdiscussion\b/i],
  ["conclusion", /结论|\bconclusions?\b/i],
  ["funding", /基金|资助|\bfunding\b/i],
  ["acknowledgements", /致谢|\backnowledg(?:e)?ments?\b/i],
  ["author-contributions", /作者贡献|\bauthor contributions?\b/i],
  ["data-availability", /数据可用性|数据获取|\bdata availability\b/i],
  ["ethics", /伦理|道德审批|\bethics?\b/i],
  ["competing-interests", /利益冲突|竞争性利益|\b(?:competing interests?|conflicts? of interest)\b/i],
];

export type RuntimeTaskPolicy = {
  applyMode: TaskApplyMode;
  reason: "locked-action" | "explicit-file-intent" | "explicit-answer-intent" | "writing-assist-llm" | "safe-default";
  allowLlmApplyMode: boolean;
};

export function isAnswerOnlyAction(action: TaskAction): boolean {
  return ANSWER_ONLY_ACTIONS.has(action);
}

export function requestsFileCommit(text: string): boolean {
  return EXPLICIT_ASSIGNMENT_RE.test(text) || (COMMIT_SPEECH_RE.test(text) && !EXPLORATORY_SPEECH_RE.test(text));
}

export function requestsExploration(text: string): boolean {
  return EXPLORATORY_SPEECH_RE.test(text) && !EXPLICIT_ASSIGNMENT_RE.test(text);
}

export function requestsWritingAssistance(text: string): boolean {
  return WRITING_ASSIST_RE.test(text) && !requestsExploration(text) && !requestsFileCommit(text);
}

/**
 * File permission is runtime-owned. Clear UI/slash actions and explicit commit
 * speech acts are still authoritative. Ambiguous assisted-writing requests are
 * sent to the TaskSpec interpreter so the model can classify conversation vs a
 * semantic file transaction, while runtime still owns ranges and PatchSets.
 */
export function runtimeTaskPolicy(args: {
  userText: string;
  lockedAction?: TaskAction;
}): RuntimeTaskPolicy {
  if (args.lockedAction) {
    return {
      applyMode: isAnswerOnlyAction(args.lockedAction) ? "answer-only" : "propose-patch",
      reason: "locked-action",
      allowLlmApplyMode: false,
    };
  }
  if (requestsExploration(args.userText)) {
    return { applyMode: "answer-only", reason: "explicit-answer-intent", allowLlmApplyMode: false };
  }
  if (requestsFileCommit(args.userText)) {
    return { applyMode: "propose-patch", reason: "explicit-file-intent", allowLlmApplyMode: false };
  }
  if (requestsWritingAssistance(args.userText)) {
    return { applyMode: "answer-only", reason: "writing-assist-llm", allowLlmApplyMode: true };
  }
  return { applyMode: "answer-only", reason: "safe-default", allowLlmApplyMode: false };
}

function namedSlot(text: string): ManuscriptSlotKind | undefined {
  return SLOT_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0];
}

function answerAction(text: string, lockedAction?: TaskAction): TaskAction {
  if (lockedAction && isAnswerOnlyAction(lockedAction)) return lockedAction;
  if (/(?:润色|改写|重写|翻译|polish|rewrite|rephrase|translate)/i.test(text)) return "polish";
  if (/(?:审阅|评审|检查逻辑|review|critique)/i.test(text)) return "review";
  if (/(?:检索|调研|查找文献|research|literature search)/i.test(text)) return "research";
  return "advice";
}

function actionContentMode(action: TaskAction): TaskContentMode {
  if (action === "draft" || action === "polish") return "generate";
  if (action === "scaffold") return "blank";
  if (action === "fill-sections") return "provided";
  return "none";
}

function mostRecentAssignment(sources: ConversationArtifact[]): ConversationArtifact | undefined {
  const currentMessageId = [...sources].reverse().find((source) => source.role === "user")?.messageId;
  if (!currentMessageId) return undefined;
  return [...sources].reverse().find((source) =>
    source.role === "user" &&
    source.messageId === currentMessageId &&
    source.kind === "assignment-value" &&
    source.text.trim(),
  );
}

function patchAction(text: string, lockedAction?: TaskAction): TaskAction {
  if (lockedAction) return lockedAction;
  if (/(?:引用|文献|cite|citation|reference)/i.test(text)) return "cite";
  if (/(?:润色|改写|重写|polish|rewrite|rephrase)/i.test(text)) return "polish";
  if (/(?:空(?:白)?结构|脚手架|搭建结构|scaffold)/i.test(text)) return "scaffold";
  return "draft";
}

function targetFor(slot: ManuscriptSlotKind, sourceIds: string[] = []): TaskTarget {
  return { slot, sourceIds };
}

/**
 * A narrow, deterministic fallback for provider/schema failures. It is allowed
 * to preserve answer-only requests and file tasks with runtime-provable scope;
 * otherwise callers must keep the task blocked.
 */
export function runtimeFallbackTask(args: {
  userText: string;
  sources: ConversationArtifact[];
  selectionAvailable: boolean;
  policy: RuntimeTaskPolicy;
  lockedAction?: TaskAction;
  repaired?: boolean;
}): SuccessfulInterpretedTask | null {
  const { policy } = args;
  if (policy.applyMode === "answer-only") {
    const action = answerAction(args.userText, args.lockedAction);
    const spec: TaskSpec = {
      schemaVersion: "2",
      action,
      applyMode: "answer-only",
      contentMode: actionContentMode(action),
      scope: args.selectionAvailable ? "selection" : "manuscript",
      evidenceMode: "none",
      targets: [],
      contextSlots: [],
    };
    return { ok: true, spec, sources: args.sources, source: "runtime", repaired: args.repaired ?? true };
  }

  const slot = namedSlot(args.userText);
  const assignment = mostRecentAssignment(args.sources);
  if (!args.lockedAction && !assignment && HISTORY_REFERENCE_RE.test(args.userText)) return null;
  let action = patchAction(args.userText, args.lockedAction);
  let targets: TaskTarget[] = [];
  let scope: TaskScope = args.selectionAvailable ? "selection" : "targets";

  if (!args.lockedAction && assignment && slot) {
    action = "fill-sections";
    targets = [targetFor(slot, [assignment.id])];
  } else if (slot) {
    targets = [targetFor(slot)];
  } else if (action === "compile-fix") {
    scope = "compile-log";
  } else if (
    action === "polish" &&
    (args.lockedAction === "polish" || /(?:全文|文章|稿件|manuscript|paper)/i.test(args.userText))
  ) {
    scope = "manuscript";
  } else if (action === "cite") {
    scope = args.selectionAvailable ? "selection" : "manuscript";
  } else if (!args.selectionAvailable) {
    return null;
  }

  if (action === "fill-sections" && targets.length === 0) return null;
  if (["draft", "scaffold", "latex"].includes(action) && targets.length === 0 && !args.selectionAvailable) {
    return null;
  }

  const spec: TaskSpec = {
    schemaVersion: "2",
    action,
    applyMode: "propose-patch",
    contentMode: actionContentMode(action),
    scope,
    evidenceMode: action === "cite" ? "literature" : "none",
    targets,
    contextSlots: [],
  };
  return { ok: true, spec, sources: args.sources, source: "runtime", repaired: args.repaired ?? true };
}
