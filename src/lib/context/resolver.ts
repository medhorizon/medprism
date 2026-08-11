import type { ContextSnapshot, TextSelection } from "./snapshot";
import { structuralMask } from "../latex/targets";
import {
  canonicalOccurrence,
  occurrencesForSlot,
} from "../manuscript/model";
import { planSlotInsertion } from "../manuscript/profiles";
import { displayHeading, normalizeHeading, SLOT_DEFINITIONS, slotKey } from "../manuscript/slots";
import type {
  ManuscriptInsertion,
  ManuscriptModel,
  ManuscriptOccurrence,
  ManuscriptSlotRef,
} from "../manuscript/types";
import { validateConversationArtifact } from "../conversationArtifacts";
import type { SuccessfulInterpretedTask, TaskContextSlot, TaskSpec, TaskTarget } from "../task/types";

export type ResolvedTargetBinding = {
  id: string;
  ref: ManuscriptSlotRef;
  targetIndex?: number;
  lockedToOccurrence?: boolean;
  occurrence?: ManuscriptOccurrence;
  insertion?: ManuscriptInsertion;
  providedText: string;
};

export type ResolvedTargetAmbiguity = {
  targetIndex: number;
  ref: ManuscriptSlotRef;
  choices: ManuscriptOccurrence[];
};

export type ResolvedSelection = {
  path: string;
  range: TextSelection;
  text: string;
};

export type ResolvedTask = {
  projectId: string;
  spec: TaskSpec;
  model: ManuscriptModel;
  sourceArtifacts: SuccessfulInterpretedTask["sources"];
  targets: ResolvedTargetBinding[];
  ambiguities: ResolvedTargetAmbiguity[];
  selection?: ResolvedSelection;
  contextBlocks: Array<{ id: string; path: string; text: string }>;
  warnings: string[];
  errors: string[];
  toolNotes: string[];
};

export type ResolvedClaimCandidate = {
  id: string;
  containerId: string;
  path: string;
  heading: string;
  range: TextSelection;
  containerRange: TextSelection;
  text: string;
  hasCitation: boolean;
};

function slotRef(target: TaskTarget | TaskContextSlot): ManuscriptSlotRef {
  return target.slot === "custom-section"
    ? { slot: "custom-section", title: target.title ?? "Section" }
    : { slot: target.slot };
}

function contextForOccurrence(occurrence: ManuscriptOccurrence): {
  id: string;
  path: string;
  text: string;
} {
  return {
    id: `context:${occurrence.id}`,
    path: occurrence.path,
    text: occurrence.body,
  };
}

function mostSpecificSources<T extends { messageId: string; start: number; end: number }>(sources: T[]): T[] {
  return sources.filter((candidate, index) =>
    !sources.some((other, otherIndex) =>
      otherIndex !== index &&
      other.messageId === candidate.messageId &&
      other.start >= candidate.start &&
      other.end <= candidate.end &&
      (other.start > candidate.start || other.end < candidate.end),
    ),
  );
}

function orderedSources<T extends { messageId: string; start: number; end: number }>(sources: T[]): T[] {
  return [...sources].sort((a, b) =>
    a.messageId.localeCompare(b.messageId) || a.start - b.start || a.end - b.end,
  );
}

function sourceSetKey(ids: readonly string[]): string {
  return [...new Set(ids)].sort().join("\n");
}

function aliasesForRef(ref: ManuscriptSlotRef): string[] {
  if (ref.slot === "custom-section") return [ref.title];
  const definition = SLOT_DEFINITIONS.find((candidate) => candidate.slot === ref.slot);
  return [
    displayHeading(ref),
    ref.slot.replace(/-/g, " "),
    ...(definition?.aliases ?? []),
  ].filter((alias, index, aliases) =>
    alias.trim() && aliases.findIndex((candidate) =>
      normalizeHeading(candidate) === normalizeHeading(alias),
    ) === index,
  );
}

function escapedAliasPattern(alias: string): string {
  return alias
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
}

function labeledLineBody(line: string, ref: ManuscriptSlotRef): string | null {
  const aliases = aliasesForRef(ref).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    const pattern = new RegExp(
      `^\\s*(?:#{1,6}\\s*)?(?:[-+*]\\s*)?${escapedAliasPattern(alias)}(?:\\b|\\s|[:：])\\s*(?:[:：\\-–—]\\s*)?(.*)$`,
      "iu",
    );
    const match = line.match(pattern);
    if (!match) continue;
    const body = (match[1] ?? "").trim();
    return body;
  }
  return null;
}

function splitLabeledText(
  text: string,
  refs: ManuscriptSlotRef[],
): Map<number, string> | null {
  const buckets = new Map<number, string[]>();
  let current: number | null = null;
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    const matched = refs
      .map((ref, index) => ({ index, body: labeledLineBody(line, ref) }))
      .find((candidate) => candidate.body !== null);
    if (matched) {
      current = matched.index;
      buckets.set(current, [
        ...(buckets.get(current) ?? []),
        matched.body ?? "",
      ]);
      continue;
    }
    if (current !== null) {
      buckets.set(current, [...(buckets.get(current) ?? []), line]);
    }
  }
  const result = new Map<number, string>();
  for (let index = 0; index < refs.length; index += 1) {
    const body = (buckets.get(index) ?? []).join("\n").trim();
    if (!body) return null;
    result.set(index, body);
  }
  return result;
}

function planProvidedTextBindings(
  interpreted: SuccessfulInterpretedTask,
): { texts: Map<number, string>; errors: string[] } {
  const texts = new Map<number, string>();
  const errors: string[] = [];
  if (interpreted.spec.action !== "fill-sections" || interpreted.spec.targets.length <= 1) {
    return { texts, errors };
  }
  const groups = new Map<string, number[]>();
  interpreted.spec.targets.forEach((target, targetIndex) => {
    const key = sourceSetKey(target.sourceIds);
    if (!key) return;
    groups.set(key, [...(groups.get(key) ?? []), targetIndex]);
  });
  for (const targetIndexes of groups.values()) {
    if (targetIndexes.length <= 1) continue;
    const sourceIds = new Set(interpreted.spec.targets[targetIndexes[0]!]!.sourceIds);
    const selectedSources = interpreted.sources.filter((source) => sourceIds.has(source.id));
    const invalidSource = selectedSources.find((source) => !validateConversationArtifact(source));
    if (invalidSource || selectedSources.length !== sourceIds.size) continue;
    const specificSources = orderedSources(mostSpecificSources(selectedSources));
    const refs = targetIndexes.map((targetIndex) => slotRef(interpreted.spec.targets[targetIndex]!));
    if (specificSources.length === targetIndexes.length) {
      for (const [offset, targetIndex] of targetIndexes.entries()) {
        texts.set(targetIndex, specificSources[offset]!.text);
      }
      continue;
    }
    const combined = specificSources.map((source) => source.text).join("\n");
    const labeled = splitLabeledText(combined, refs);
    if (labeled) {
      for (const [offset, targetIndex] of targetIndexes.entries()) {
        texts.set(targetIndex, labeled.get(offset)!);
      }
      continue;
    }
    errors.push(
      `Provided content could not be uniquely split across ${refs.map(displayHeading).join(", ")}.`,
    );
  }
  return { texts, errors };
}

function defaultDocumentTargets(model: ManuscriptModel): ManuscriptOccurrence[] {
  return model.occurrences
    .filter((occurrence) => occurrence.canonical)
    .filter((occurrence) =>
      ["introduction", "methods", "results", "discussion", "conclusion"].includes(
        occurrence.ref.slot,
      ),
    )
    .sort((a, b) => a.path.localeCompare(b.path) || a.wrapperRange.start - b.wrapperRange.start);
}

/** Bind semantic targets to runtime-owned ranges or profile insertions. */
export function resolveTaskContext(args: {
  snapshot: ContextSnapshot;
  model: ManuscriptModel;
  interpreted: SuccessfulInterpretedTask;
}): ResolvedTask {
  const { snapshot, model, interpreted } = args;
  const warnings: string[] = [];
  const errors: string[] = [];
  const bindings: ResolvedTargetBinding[] = [];
  const ambiguities: ResolvedTargetAmbiguity[] = [];
  const contextBlocks: ResolvedTask["contextBlocks"] = [];
  const contextBlockIds = new Set<string>();
  const providedPlan = planProvidedTextBindings(interpreted);
  errors.push(...providedPlan.errors);
  let selection: ResolvedSelection | undefined;

  const pushContext = (occurrence: ManuscriptOccurrence) => {
    const context = contextForOccurrence(occurrence);
    if (contextBlockIds.has(context.id)) return;
    contextBlockIds.add(context.id);
    contextBlocks.push(context);
  };

  if (
    interpreted.spec.scope === "selection" &&
    snapshot.selection &&
    snapshot.selectedText !== undefined
  ) {
    selection = {
      path: snapshot.activeFile,
      range: snapshot.selection,
      text: snapshot.selectedText,
    };
    contextBlockIds.add("context:selection");
    contextBlocks.push({
      id: "context:selection",
      path: snapshot.activeFile,
      text: snapshot.selectedText,
    });
  }

  const selectionByTarget = new Map(
    interpreted.targetSelections?.map((selection) => [selection.targetIndex, selection.occurrenceId]) ?? [],
  );

  for (const [targetIndex, target] of interpreted.spec.targets.entries()) {
    const ref = slotRef(target);
    const occurrences = occurrencesForSlot(model, ref);
    const selectedOccurrenceId = selectionByTarget.get(targetIndex);
    let occurrence: ManuscriptOccurrence | undefined;
    if (selectedOccurrenceId) {
      occurrence = occurrences.find((candidate) => candidate.id === selectedOccurrenceId);
      if (!occurrence) {
        errors.push(`Selected target for ${slotKey(ref)} is no longer available.`);
        continue;
      }
    } else if (occurrences.length > 1) {
      occurrence = canonicalOccurrence(model, ref);
      if (!occurrence) {
        ambiguities.push({ targetIndex, ref, choices: occurrences });
        continue;
      }
      warnings.push(
        `Multiple active occurrences exist for ${slotKey(ref)}; using canonical target ${occurrence.path}.`,
      );
    } else {
      occurrence = canonicalOccurrence(model, ref);
    }
    const sourceIds = new Set(target.sourceIds);
    const selectedSources = interpreted.sources.filter((source) => sourceIds.has(source.id));
    const invalidSource = selectedSources.find((source) => !validateConversationArtifact(source));
    if (invalidSource || selectedSources.length !== sourceIds.size) {
      errors.push(`Trusted source artifacts are missing or invalid for ${slotKey(ref)}.`);
      continue;
    }
    const specificSources = mostSpecificSources(selectedSources);
    const uniqueSourceTexts = [...new Set(specificSources.map((source) => source.text))];
    const plannedProvidedText = providedPlan.texts.get(targetIndex);
    if (ref.slot === "title" && uniqueSourceTexts.length > 1 && plannedProvidedText === undefined) {
      errors.push("The title target resolves to multiple distinct source artifacts.");
      continue;
    }
    const providedText = plannedProvidedText ?? uniqueSourceTexts.join("\n");
    if (occurrence) {
      const binding: ResolvedTargetBinding = {
        id: `binding:${occurrence.id}`,
        ref,
        targetIndex,
        ...(selectedOccurrenceId ? { lockedToOccurrence: true } : {}),
        occurrence,
        providedText,
      };
      bindings.push(binding);
      pushContext(occurrence);
      continue;
    }

    if (["scaffold", "fill-sections", "draft", "latex"].includes(interpreted.spec.action)) {
      const insertion = planSlotInsertion(model, ref);
      if (!insertion) {
        errors.push(`No profile insertion point exists for ${slotKey(ref)}.`);
        continue;
      }
      bindings.push({
        id: `binding:new:${slotKey(ref)}`,
        ref,
        targetIndex,
        insertion,
        providedText,
      });
      continue;
    }
    errors.push(`Requested slot ${slotKey(ref)} does not exist in the manuscript.`);
  }

  for (const contextSlot of interpreted.spec.contextSlots ?? []) {
    const ref = slotRef(contextSlot);
    const occurrence = canonicalOccurrence(model, ref);
    if (!occurrence) {
      warnings.push(`Context slot ${slotKey(ref)} is not available in the active manuscript graph.`);
      continue;
    }
    pushContext(occurrence);
  }

  if (interpreted.spec.targets.length === 0 && !selection) {
    const defaults = defaultDocumentTargets(model);
    if (interpreted.spec.scope === "manuscript" || interpreted.spec.action === "advice") {
      defaults.forEach(pushContext);
    } else if (interpreted.spec.scope === "active-file") {
      contextBlockIds.add("context:active-file");
      contextBlocks.push({
        id: "context:active-file",
        path: snapshot.activeFile,
        text: snapshot.localContext,
      });
    }
    if (
      ["cite", "polish"].includes(interpreted.spec.action) &&
      interpreted.spec.scope === "manuscript" &&
      defaults.length > 0
    ) {
      for (const occurrence of defaults) {
        if (occurrencesForSlot(model, occurrence.ref).length > 1) {
          errors.push(`Semantic slot ${slotKey(occurrence.ref)} has multiple active occurrences.`);
          continue;
        }
        bindings.push({
          id: `binding:${occurrence.id}`,
          ref: occurrence.ref,
          occurrence,
          providedText: "",
        });
      }
    }
  }

  if (
    interpreted.spec.applyMode === "propose-patch" &&
    interpreted.spec.action !== "compile-fix" &&
    !selection &&
    bindings.length === 0 &&
    ambiguities.length === 0 &&
    errors.length === 0
  ) {
    errors.push("No trusted selection or semantic target is available for this file transaction.");
  }

  return {
    projectId: snapshot.projectId,
    spec: interpreted.spec,
    model,
    sourceArtifacts: interpreted.sources,
    targets: bindings,
    ambiguities,
    ...(selection ? { selection } : {}),
    contextBlocks,
    warnings,
    errors,
    toolNotes: [
      `task:${interpreted.spec.action}`,
      `task-source:${interpreted.source}`,
      `task-repaired:${interpreted.repaired ? "yes" : "no"}`,
      `context-targets:${bindings.length}`,
      `context-slots:${bindings.map((binding) => slotKey(binding.ref)).join(",") || "none"}`,
      `context-source-slots:${(interpreted.spec.contextSlots ?? []).map((slot) => slotKey(slotRef(slot))).join(",") || "none"}`,
      `context-selection:${selection ? "yes" : "no"}`,
    ],
  };
}

function claimId(path: string, start: number, end: number): string {
  return `claim:${encodeURIComponent(path)}:${start}:${end}`;
}

function sentenceRanges(
  masked: string,
  containerRange: TextSelection,
): TextSelection[] {
  const ranges: TextSelection[] = [];
  let start = containerRange.start;
  const push = (rawEnd: number) => {
    let sentenceStart = start;
    let sentenceEnd = rawEnd;
    while (sentenceStart < sentenceEnd && /\s/.test(masked[sentenceStart] ?? "")) {
      sentenceStart += 1;
    }
    while (sentenceEnd > sentenceStart && /\s/.test(masked[sentenceEnd - 1] ?? "")) {
      sentenceEnd -= 1;
    }
    start = rawEnd;
    if (sentenceEnd <= sentenceStart) return;
    const visible = masked
      .slice(sentenceStart, sentenceEnd)
      .replace(/\\cite\w*\s*\{[^}]*\}/gi, " ")
      .replace(/\\[A-Za-z@]+\*?(?:\s*\[[^\]]*\])?/g, " ")
      .replace(/[{}$&%#_^~]/g, " ");
    if ((visible.match(/[\p{L}\p{N}]/gu) ?? []).length < 12) return;
    ranges.push({ start: sentenceStart, end: sentenceEnd });
  };

  for (let index = containerRange.start; index < containerRange.end; index += 1) {
    const character = masked[index] ?? "";
    const next = masked[index + 1] ?? "";
    const previous = masked[index - 1] ?? "";
    const decimalPoint = character === "." && /\d/.test(previous) && /\d/.test(next);
    const terminal = /[.!?。！？]/u.test(character) && !decimalPoint;
    const paragraphEnd = (character === "\n" || character === "\r") &&
      /^\s*(?:\r?\n|$)/.test(masked.slice(index + 1, containerRange.end));
    if (terminal || paragraphEnd) push(index + 1);
  }
  if (start < containerRange.end) push(containerRange.end);
  return ranges;
}

/**
 * Split only runtime-resolved selection/section ranges into stable claim IDs.
 * The model can select these IDs but never owns their physical locations.
 */
export function resolveCitationClaims(resolved: ResolvedTask): ResolvedClaimCandidate[] {
  const containers: Array<{
    id: string;
    path: string;
    heading: string;
    range: TextSelection;
  }> = [];
  if (resolved.selection) {
    containers.push({
      id: "selection",
      path: resolved.selection.path,
      heading: "Selection",
      range: resolved.selection.range,
    });
  } else {
    const seen = new Set<string>();
    for (const target of resolved.targets) {
      const occurrence = target.occurrence;
      if (!occurrence || seen.has(occurrence.id)) continue;
      seen.add(occurrence.id);
      containers.push({
        id: occurrence.id,
        path: occurrence.path,
        heading: occurrence.heading,
        range: occurrence.bodyRange,
      });
    }
  }

  const claims: ResolvedClaimCandidate[] = [];
  for (const container of containers) {
    const source = resolved.model.files[container.path];
    if (source === undefined) continue;
    const masked = structuralMask(source);
    for (const range of sentenceRanges(masked, container.range)) {
      const text = source.slice(range.start, range.end);
      claims.push({
        id: claimId(container.path, range.start, range.end),
        containerId: container.id,
        path: container.path,
        heading: container.heading,
        range,
        containerRange: container.range,
        text,
        hasCitation: /\\cite\w*\s*\{[^}]+\}/i.test(text),
      });
    }
  }
  return claims;
}
