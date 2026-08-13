import academicPaperReviewerSkill from "../../../skills/staged/academic-paper-reviewer/SKILL.md?raw";
import { assertSafeProjectRelativePath } from "../projectPath";
import { MAX_PROJECT_MEMORY_CHARS } from "../projectMemory";
import { taggedPromptData } from "../promptData";
import { compactPaperHits } from "../research/service";
import { parseModelWorkflowEnvelope } from "../replyParse";
import { buildWorkflowSystemPrompt } from "./prompt";
import {
  emptyAgentResult,
  type ReviewCategory,
  type ReviewCoverage,
  type ReviewFinding,
  type ReviewReport,
  type ReviewSeverity,
  type WorkflowHandler,
  type WorkflowResult,
} from "./types";

const REVIEW_TOTAL_LIMIT = 30_000;
const REVIEW_FILE_LIMIT = 12_000;
const SEVERITIES = new Set<ReviewSeverity>(["major", "moderate", "minor"]);
const CATEGORIES = new Set<ReviewCategory>([
  "scientific",
  "statistics",
  "evidence",
  "consistency",
  "writing",
  "latex",
]);

export type ReviewContext = {
  prompt: string;
  coverage: ReviewCoverage;
};

function isReviewableTextPath(path: string): boolean {
  return /\.(?:tex|bib)$/i.test(path);
}

function safeProjectPaths(input: Parameters<WorkflowHandler>[0]): string[] {
  const paths: string[] = [];
  for (const rawPath of Object.keys(input.ctx.files).sort()) {
    try {
      paths.push(assertSafeProjectRelativePath(rawPath));
    } catch {
      paths.push(rawPath);
    }
  }
  return [...new Set(paths)];
}

function prioritizedReviewPaths(input: Parameters<WorkflowHandler>[0]): string[] {
  const preferred = [input.ctx.activeFile, input.ctx.mainFile].filter(
    (path): path is string => typeof path === "string" && isReviewableTextPath(path),
  );
  const reviewable = Object.keys(input.ctx.files)
    .filter(isReviewableTextPath)
    .sort();
  return [...new Set([...preferred, ...reviewable])];
}

export function collectReviewContext(
  input: Parameters<WorkflowHandler>[0],
): ReviewContext {
  const files: Array<{ path: string; content: string; truncated: boolean }> = [];
  const limitations: string[] = [];
  let remaining = REVIEW_TOTAL_LIMIT;

  for (const rawPath of prioritizedReviewPaths(input)) {
    let path: string;
    try {
      path = assertSafeProjectRelativePath(rawPath);
    } catch {
      continue;
    }
    const content = input.ctx.files[path];
    if (content === undefined || remaining <= 0) continue;

    const allowance = Math.min(REVIEW_FILE_LIMIT, remaining);
    const excerpt = content.slice(0, allowance);
    const truncated = excerpt.length < content.length;
    files.push({ path, content: excerpt, truncated });
    remaining -= excerpt.length;
    if (truncated) limitations.push(`${path} was truncated to ${excerpt.length} characters.`);
  }

  const filesRead = files.map((file) => file.path);
  const readSet = new Set(filesRead);
  const filesNotRead = safeProjectPaths(input).filter((path) => !readSet.has(path));
  if (filesNotRead.length) {
    limitations.push(
      `${filesNotRead.length} project file(s) were not supplied to the review model; see filesNotRead.`,
    );
  }
  if (!files.length) limitations.push("No reviewable LaTeX or bibliography files were supplied.");

  const memoryNotes = input.ctx.memoryNotes?.replace(/\r\n?/g, "\n").trim();
  return {
    prompt: [
      taggedPromptData("review_context", 'trust="untrusted-data"', {
        files,
        ...(memoryNotes
          ? { projectMemoryNotes: memoryNotes.slice(0, MAX_PROJECT_MEMORY_CHARS) }
          : {}),
      }),
      taggedPromptData("user_request", "", { text: input.request.userText }),
    ].join("\n\n"),
    coverage: {
      filesRead,
      filesNotRead,
      limitations,
    },
  };
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return [...value];
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function parseFinding(value: unknown, readablePaths: Set<string>): ReviewFinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Review finding must be an object");
  }
  const record = value as Record<string, unknown>;
  const severity = record.severity as ReviewSeverity;
  const category = record.category as ReviewCategory;
  if (!SEVERITIES.has(severity)) throw new Error(`Invalid review severity: ${String(record.severity)}`);
  if (!CATEGORIES.has(category)) throw new Error(`Invalid review category: ${String(record.category)}`);
  if (typeof record.canApplyAsEdit !== "boolean") {
    throw new Error("Review finding canApplyAsEdit must be boolean");
  }

  let location: ReviewFinding["location"];
  if (record.location !== undefined) {
    if (!record.location || typeof record.location !== "object" || Array.isArray(record.location)) {
      throw new Error("Review finding location must be an object");
    }
    const rawLocation = record.location as Record<string, unknown>;
    const path = typeof rawLocation.path === "string" && rawLocation.path.trim()
      ? assertSafeProjectRelativePath(rawLocation.path)
      : undefined;
    if (path && !readablePaths.has(path)) {
      throw new Error(`Review finding refers to a file that was not supplied: ${path}`);
    }
    const text = typeof rawLocation.text === "string" && rawLocation.text.trim()
      ? rawLocation.text.trim()
      : undefined;
    if (path || text) location = { ...(path ? { path } : {}), ...(text ? { text } : {}) };
  }

  return {
    severity,
    category,
    ...(location ? { location } : {}),
    issue: requiredString(record, "issue"),
    whyItMatters: requiredString(record, "whyItMatters"),
    recommendation: requiredString(record, "recommendation"),
    canApplyAsEdit: record.canApplyAsEdit,
  };
}

export function parseReviewReport(args: {
  value: unknown;
  summary: string;
  warnings: string[];
  coverage: ReviewCoverage;
}): ReviewReport {
  if (!args.value || typeof args.value !== "object" || Array.isArray(args.value)) {
    throw new Error("Review payload must be an object");
  }
  const record = args.value as Record<string, unknown>;
  if (!Array.isArray(record.findings)) throw new Error("Review findings must be an array");
  const readablePaths = new Set(args.coverage.filesRead);
  const modelLimitations = stringArray(record.limitations, "review.limitations");
  return {
    schemaVersion: "1",
    summary: args.summary,
    warnings: args.warnings,
    coverage: {
      filesRead: [...args.coverage.filesRead],
      filesNotRead: [...args.coverage.filesNotRead],
      limitations: [...args.coverage.limitations, ...modelLimitations],
    },
    findings: record.findings.map((finding) => parseFinding(finding, readablePaths)),
  };
}

function renderReview(report: ReviewReport): string {
  const lines = [report.summary];
  for (const finding of report.findings) {
    const location = finding.location?.path ? ` (${finding.location.path})` : "";
    lines.push(
      `\n[${finding.severity.toUpperCase()}] ${finding.category}${location}: ${finding.issue}`,
      `Why it matters: ${finding.whyItMatters}`,
      `Recommendation: ${finding.recommendation}`,
    );
  }
  if (report.coverage.limitations.length) {
    lines.push(`\nReview limitations: ${report.coverage.limitations.join(" ")}`);
  }
  return lines.join("\n");
}

function invalidReviewResult(message: string, content = ""): WorkflowResult {
  return {
    agent: emptyAgentResult("review", "Review result was rejected", [message]),
    content: content || message,
    toolNotes: [],
  };
}

export const runReviewWorkflow: WorkflowHandler = async (input) => {
  const reviewContext = collectReviewContext(input);
  if (!reviewContext.coverage.filesRead.length) {
    return invalidReviewResult("没有可用于审稿的 LaTeX 文本文件。");
  }
  const raw = await input.services.complete({
    config: input.config,
    messages: [
      {
        role: "system",
        content: buildWorkflowSystemPrompt({
          workflow: "review",
          skillId: "academic-paper-reviewer",
          skill: academicPaperReviewerSkill,
          capabilities: input.research ? ["research"] : [],
        }),
      },
      ...(input.research
        ? [{
            role: "user" as const,
            content: taggedPromptData(
              "trusted_tool_results",
              'source="paper_search"',
              {
                query: input.research.query,
                purpose: input.research.purpose,
                candidates: compactPaperHits(input.research.hits),
              },
            ),
          }]
        : []),
      ...input.history,
      { role: "user", content: reviewContext.prompt },
    ],
  });
  const parsed = parseModelWorkflowEnvelope(raw, "review");
  if (!parsed.ok) return invalidReviewResult(parsed.error.message, parsed.rawContent);
  if (parsed.envelope.proposal || parsed.envelope.citationPlanValue !== undefined) {
    return invalidReviewResult(
      "Review workflow is advisory and must not return a file modification",
      parsed.envelope.content,
    );
  }
  if (parsed.envelope.reviewValue === undefined) {
    return invalidReviewResult("Review workflow did not return a ReviewReport", parsed.envelope.content);
  }

  let report: ReviewReport;
  try {
    report = parseReviewReport({
      value: parsed.envelope.reviewValue,
      summary: parsed.envelope.summary,
      warnings: parsed.envelope.warnings,
      coverage: reviewContext.coverage,
    });
  } catch (error) {
    return invalidReviewResult(
      error instanceof Error ? error.message : String(error),
      parsed.envelope.content,
    );
  }

  return {
    agent: {
      schemaVersion: "1",
      workflow: "review",
      summary: report.summary,
      warnings: [...report.warnings, ...(input.research?.warnings ?? [])],
      review: report,
    },
    content: parsed.envelope.content || renderReview(report),
    toolNotes: [
      "skill:academic-paper-reviewer",
      `review_files:${report.coverage.filesRead.length}`,
      ...(input.research
        ? [`research-consumed:${input.research.hits.length}`]
        : []),
    ],
  };
};
