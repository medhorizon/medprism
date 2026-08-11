import { MANUSCRIPT_SLOT_KINDS } from "../manuscript/slots";
import type { ManuscriptSlotKind } from "../manuscript/types";
import type {
  TaskAction,
  TaskApplyMode,
  TaskContentMode,
  TaskEvidenceMode,
  TaskScope,
  TaskSpec,
  TaskContextSlot,
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
const TASK_KEYS = new Set([
  "schemaVersion", "action", "applyMode", "contentMode", "scope",
  "evidenceMode", "targets", "contextSlots",
]);
const TARGET_KEYS = new Set(["slot", "title", "sourceIds"]);
const CONTEXT_SLOT_KEYS = new Set(["slot", "title"]);

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

function parseTargets(value: unknown, allowedSourceIds: Set<string>): TaskTarget[] | null {
  if (!Array.isArray(value)) return null;
  const targets: TaskTarget[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const raw = item as Record<string, unknown>;
    if (Object.keys(raw).some((key) => !TARGET_KEYS.has(key))) return null;
    if (typeof raw.slot !== "string") return null;
    const isCustom = raw.slot === "custom-section";
    if (!isCustom && !MANUSCRIPT_SLOT_KINDS.has(raw.slot as ManuscriptSlotKind)) return null;
    if (isCustom && (typeof raw.title !== "string" || !raw.title.trim())) return null;
    if (!isCustom && raw.title !== undefined) return null;
    if (!Array.isArray(raw.sourceIds) || raw.sourceIds.some((id) => typeof id !== "string" || !allowedSourceIds.has(id))) {
      return null;
    }
    targets.push({
      slot: raw.slot as TaskTarget["slot"],
      ...(isCustom ? { title: (raw.title as string).trim() } : {}),
      sourceIds: [...new Set(raw.sourceIds as string[])],
    });
  }
  return targets;
}

function parseContextSlots(value: unknown): TaskContextSlot[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const slots: TaskContextSlot[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const raw = item as Record<string, unknown>;
    if (Object.keys(raw).some((key) => !CONTEXT_SLOT_KEYS.has(key))) return null;
    if (typeof raw.slot !== "string") return null;
    const isCustom = raw.slot === "custom-section";
    if (!isCustom && !MANUSCRIPT_SLOT_KINDS.has(raw.slot as ManuscriptSlotKind)) return null;
    if (isCustom && (typeof raw.title !== "string" || !raw.title.trim())) return null;
    if (!isCustom && raw.title !== undefined) return null;
    slots.push({
      slot: raw.slot as TaskContextSlot["slot"],
      ...(isCustom ? { title: (raw.title as string).trim() } : {}),
    });
  }
  const seen = new Set<string>();
  return slots.filter((slot) => {
    const key = slot.slot === "custom-section" ? `custom:${slot.title}` : slot.slot;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function invariantError(spec: TaskSpec): string | null {
  if (["advice", "review", "research"].includes(spec.action)) {
    if (spec.applyMode !== "answer-only" || spec.contentMode !== "none" || spec.targets.length !== 0) {
      return `${spec.action} must be answer-only with no content or targets`;
    }
  } else if (
    spec.applyMode === "answer-only" &&
    !["draft", "polish"].includes(spec.action)
  ) {
    return `${spec.action} cannot run as answer-only`;
  }
  if (
    spec.applyMode === "propose-patch" &&
    !["compile-fix", "cite"].includes(spec.action) &&
    spec.scope !== "selection" &&
    !(spec.action === "polish" && spec.scope === "manuscript") &&
    spec.targets.length === 0
  ) {
    return `${spec.action} requires a target or selection`;
  }
  if (spec.action === "scaffold") {
    if (spec.applyMode !== "propose-patch" || spec.contentMode !== "blank" || spec.evidenceMode !== "none" || spec.targets.length === 0) {
      return "scaffold must use propose-patch, blank, and no evidence";
    }
  }
  if (spec.action === "fill-sections") {
    if (spec.applyMode !== "propose-patch" || spec.contentMode !== "provided" || spec.targets.length === 0 || spec.targets.some((target) => target.sourceIds.length === 0)) {
      return "fill-sections must use provided content and at least one sourced target";
    }
  }
  if (spec.action === "cite") {
    if (spec.applyMode !== "propose-patch" || spec.evidenceMode !== "literature") {
      return "cite must use propose-patch and literature evidence";
    }
    if (spec.targets.length === 0 && !["selection", "manuscript"].includes(spec.scope)) {
      return "cite without explicit targets requires a selection or manuscript scope";
    }
  }
  if (spec.action === "draft" && spec.contentMode !== "generate") {
    return "draft must use generated content";
  }
  if (spec.action === "polish" && !["none", "generate"].includes(spec.contentMode)) {
    return "polish must use generated or no content mode";
  }
  if (spec.action === "compile-fix" && spec.scope !== "compile-log") {
    return "compile-fix requires compile-log scope";
  }
  return null;
}

export function parseTaskSpec(
  raw: string,
  allowedSourceIds: readonly string[],
  options?: {
    lockedAction?: TaskAction;
    requireProposePatch?: boolean;
    requireAnswerOnly?: boolean;
    /** Runtime-owned file permission; model applyMode is treated as a recommendation only. */
    authoritativeApplyMode?: TaskApplyMode;
    selectionAvailable?: boolean;
  },
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
  const unexpected = Object.keys(object).find((key) => !TASK_KEYS.has(key));
  if (unexpected) return { ok: false, message: `TaskSpec contains unsupported field: ${unexpected}` };
  const schemaVersion = object.schemaVersion === 2 ? "2" : object.schemaVersion;
  if (schemaVersion !== "2") return { ok: false, message: 'TaskSpec schemaVersion must be "2"' };
  if (typeof object.action !== "string" || !ACTIONS.has(object.action as TaskAction)) return { ok: false, message: "TaskSpec action is invalid" };
  const action = options?.lockedAction ?? object.action;
  if (typeof object.applyMode !== "string" || !APPLY_MODES.has(object.applyMode as TaskApplyMode)) return { ok: false, message: "TaskSpec applyMode is invalid" };
  if (typeof object.contentMode !== "string" || !CONTENT_MODES.has(object.contentMode as TaskContentMode)) return { ok: false, message: "TaskSpec contentMode is invalid" };
  if (typeof object.scope !== "string" || !SCOPES.has(object.scope as TaskScope)) return { ok: false, message: "TaskSpec scope is invalid" };
  if (typeof object.evidenceMode !== "string" || !EVIDENCE_MODES.has(object.evidenceMode as TaskEvidenceMode)) return { ok: false, message: "TaskSpec evidenceMode is invalid" };
  const targets = parseTargets(object.targets, new Set(allowedSourceIds));
  if (!targets) return { ok: false, message: "TaskSpec targets are invalid" };
  const contextSlots = parseContextSlots(object.contextSlots);
  if (!contextSlots) return { ok: false, message: "TaskSpec contextSlots are invalid" };
  const spec: TaskSpec = {
    schemaVersion: "2",
    action: action as TaskAction,
    applyMode: options?.authoritativeApplyMode ?? object.applyMode as TaskApplyMode,
    contentMode: object.contentMode as TaskContentMode,
    scope: object.scope as TaskScope,
    evidenceMode: object.evidenceMode as TaskEvidenceMode,
    targets,
    contextSlots,
  };
  if (options?.requireProposePatch && spec.applyMode !== "propose-patch") {
    return { ok: false, message: "The user explicitly requested a file change; propose-patch is required" };
  }
  if (options?.requireAnswerOnly && spec.applyMode !== "answer-only") {
    return { ok: false, message: "The user is exploring candidates or asking a question; answer-only is required" };
  }
  if (
    options?.selectionAvailable === false &&
    spec.applyMode === "propose-patch" &&
    spec.scope === "selection" &&
    spec.targets.length === 0
  ) {
    return { ok: false, message: "No UI selection is available; choose a semantic target" };
  }
  const invariant = invariantError(spec);
  return invariant ? { ok: false, message: invariant } : { ok: true, value: spec };
}
