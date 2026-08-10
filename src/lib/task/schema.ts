import { MANUSCRIPT_SLOT_KINDS } from "../manuscript/slots";
import type { ManuscriptSlotKind } from "../manuscript/types";
import type {
  TaskAction,
  TaskApplyMode,
  TaskContentMode,
  TaskEvidenceMode,
  TaskScope,
  TaskSpec,
  TaskTarget,
} from "./types";

const ACTIONS = new Set<TaskAction>([
  "advice", "draft", "polish", "scaffold", "fill-sections", "cite",
  "review", "research", "latex", "compile-fix",
]);
const APPLY_MODES = new Set<TaskApplyMode>(["answer-only", "propose-patch"]);
const CONTENT_MODES = new Set<TaskContentMode>(["none", "generate", "provided", "blank"]);
const SCOPES = new Set<TaskScope>(["selection", "targets", "active-file", "manuscript", "compile-log"]);
const EVIDENCE_MODES = new Set<TaskEvidenceMode>(["none", "literature"]);
const FORBIDDEN_KEYS = new Set([
  "path", "range", "oldText", "newText", "anchor", "op", "baseSha256",
  "projectRevision", "patch", "patchSet", "patchProposal", "operations",
]);

export type ParseTaskSpecResult =
  | { ok: true; value: TaskSpec }
  | { ok: false; message: string };

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("TaskSpec JSON object was not found");
  const slice = candidate
    .slice(start, end + 1)
    .replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(slice) as unknown;
}

function containsForbiddenKey(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const forbidden = containsForbiddenKey(item);
      if (forbidden) return forbidden;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) return key;
    const forbidden = containsForbiddenKey(child);
    if (forbidden) return forbidden;
  }
  return null;
}

function parseTargets(value: unknown, allowedSegmentIds: Set<string>): TaskTarget[] | null {
  if (!Array.isArray(value)) return null;
  const targets: TaskTarget[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const raw = item as Record<string, unknown>;
    if (typeof raw.slot !== "string") return null;
    const isCustom = raw.slot === "custom-section";
    if (!isCustom && !MANUSCRIPT_SLOT_KINDS.has(raw.slot as ManuscriptSlotKind)) return null;
    if (isCustom && (typeof raw.title !== "string" || !raw.title.trim())) return null;
    if (!Array.isArray(raw.messageSegmentIds) || raw.messageSegmentIds.some((id) => typeof id !== "string" || !allowedSegmentIds.has(id))) {
      return null;
    }
    targets.push({
      slot: raw.slot as TaskTarget["slot"],
      ...(isCustom ? { title: (raw.title as string).trim() } : {}),
      messageSegmentIds: [...new Set(raw.messageSegmentIds as string[])],
    });
  }
  return targets;
}

function invariantError(spec: TaskSpec): string | null {
  if (["advice", "review", "research"].includes(spec.action)) {
    if (spec.applyMode !== "answer-only") return `${spec.action} must be answer-only`;
  }
  if (spec.action === "scaffold") {
    if (spec.applyMode !== "propose-patch" || spec.contentMode !== "blank" || spec.evidenceMode !== "none") {
      return "scaffold must use propose-patch, blank, and no evidence";
    }
  }
  if (spec.action === "fill-sections" && spec.contentMode !== "provided") {
    return "fill-sections must use provided content";
  }
  if (spec.action === "cite") {
    if (spec.applyMode !== "propose-patch" || spec.evidenceMode !== "literature") {
      return "cite must use propose-patch and literature evidence";
    }
  }
  return null;
}

export function parseTaskSpec(
  raw: string,
  allowedSegmentIds: readonly string[],
  lockedAction?: TaskAction,
): ParseTaskSpecResult {
  let value: unknown;
  try {
    value = extractJson(raw);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  const forbidden = containsForbiddenKey(value);
  if (forbidden) return { ok: false, message: `TaskSpec contains forbidden runtime field: ${forbidden}` };
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, message: "TaskSpec must be an object" };
  const object = value as Record<string, unknown>;
  const schemaVersion = object.schemaVersion === 1 ? "1" : object.schemaVersion;
  if (schemaVersion !== "1") return { ok: false, message: 'TaskSpec schemaVersion must be "1"' };
  const action = lockedAction ?? object.action;
  if (typeof action !== "string" || !ACTIONS.has(action as TaskAction)) return { ok: false, message: "TaskSpec action is invalid" };
  if (typeof object.applyMode !== "string" || !APPLY_MODES.has(object.applyMode as TaskApplyMode)) return { ok: false, message: "TaskSpec applyMode is invalid" };
  if (typeof object.contentMode !== "string" || !CONTENT_MODES.has(object.contentMode as TaskContentMode)) return { ok: false, message: "TaskSpec contentMode is invalid" };
  if (typeof object.scope !== "string" || !SCOPES.has(object.scope as TaskScope)) return { ok: false, message: "TaskSpec scope is invalid" };
  if (typeof object.evidenceMode !== "string" || !EVIDENCE_MODES.has(object.evidenceMode as TaskEvidenceMode)) return { ok: false, message: "TaskSpec evidenceMode is invalid" };
  const targets = parseTargets(object.targets, new Set(allowedSegmentIds));
  if (!targets) return { ok: false, message: "TaskSpec targets are invalid" };
  const spec: TaskSpec = {
    schemaVersion: "1",
    action: action as TaskAction,
    applyMode: object.applyMode as TaskApplyMode,
    contentMode: object.contentMode as TaskContentMode,
    scope: object.scope as TaskScope,
    evidenceMode: object.evidenceMode as TaskEvidenceMode,
    targets,
  };
  const invariant = invariantError(spec);
  return invariant ? { ok: false, message: invariant } : { ok: true, value: spec };
}

export function safeAdviceTask(): TaskSpec {
  return {
    schemaVersion: "1",
    action: "advice",
    applyMode: "answer-only",
    contentMode: "none",
    scope: "active-file",
    evidenceMode: "none",
    targets: [],
  };
}
