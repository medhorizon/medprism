import type { ContextSnapshot, TextSelection } from "./snapshot";
import {
  canonicalOccurrence,
  occurrencesForSlot,
} from "../manuscript/model";
import { planSlotInsertion } from "../manuscript/profiles";
import { slotKey } from "../manuscript/slots";
import type {
  ManuscriptInsertion,
  ManuscriptModel,
  ManuscriptOccurrence,
  ManuscriptSlotRef,
} from "../manuscript/types";
import { segmentTextByIds } from "../task/segments";
import type { InterpretedTask, TaskSpec } from "../task/types";

export type ResolvedTargetBinding = {
  id: string;
  ref: ManuscriptSlotRef;
  occurrence?: ManuscriptOccurrence;
  insertion?: ManuscriptInsertion;
  providedText: string;
};

export type ResolvedSelection = {
  path: string;
  range: TextSelection;
  text: string;
};

export type ResolvedTask = {
  spec: TaskSpec;
  model: ManuscriptModel;
  targets: ResolvedTargetBinding[];
  selection?: ResolvedSelection;
  contextBlocks: Array<{ id: string; path: string; text: string }>;
  warnings: string[];
  errors: string[];
  toolNotes: string[];
};

function targetRef(target: TaskSpec["targets"][number]): ManuscriptSlotRef {
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
  interpreted: InterpretedTask;
}): ResolvedTask {
  const { snapshot, model, interpreted } = args;
  const warnings: string[] = [];
  const errors: string[] = [];
  const bindings: ResolvedTargetBinding[] = [];
  const contextBlocks: ResolvedTask["contextBlocks"] = [];
  let selection: ResolvedSelection | undefined;

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
    contextBlocks.push({
      id: "context:selection",
      path: snapshot.activeFile,
      text: snapshot.selectedText,
    });
  }

  for (const target of interpreted.spec.targets) {
    const ref = targetRef(target);
    const occurrences = occurrencesForSlot(model, ref);
    if (occurrences.length > 1) {
      errors.push(`Semantic slot ${slotKey(ref)} has multiple active occurrences.`);
      continue;
    }
    const occurrence = canonicalOccurrence(model, ref);
    const providedText = segmentTextByIds(interpreted.segments, target.messageSegmentIds);
    if (occurrence) {
      const binding: ResolvedTargetBinding = {
        id: `binding:${occurrence.id}`,
        ref,
        occurrence,
        providedText,
      };
      bindings.push(binding);
      contextBlocks.push(contextForOccurrence(occurrence));
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
        insertion,
        providedText,
      });
      continue;
    }
    errors.push(`Requested slot ${slotKey(ref)} does not exist in the manuscript.`);
  }

  if (interpreted.spec.targets.length === 0 && !selection) {
    const defaults = defaultDocumentTargets(model);
    if (interpreted.spec.scope === "manuscript" || interpreted.spec.action === "advice") {
      contextBlocks.push(...defaults.map(contextForOccurrence));
    } else if (interpreted.spec.scope === "active-file") {
      contextBlocks.push({
        id: "context:active-file",
        path: snapshot.activeFile,
        text: snapshot.localContext,
      });
    }
    if (interpreted.spec.action === "cite" && defaults.length > 0) {
      for (const occurrence of defaults) {
        bindings.push({
          id: `binding:${occurrence.id}`,
          ref: occurrence.ref,
          occurrence,
          providedText: "",
        });
      }
    }
  }

  if (interpreted.warning) warnings.push(interpreted.warning);
  return {
    spec: interpreted.spec,
    model,
    targets: bindings,
    ...(selection ? { selection } : {}),
    contextBlocks,
    warnings,
    errors,
    toolNotes: [
      `task:${interpreted.spec.action}`,
      `task-source:${interpreted.source}`,
      `task-repaired:${interpreted.repaired ? "yes" : "no"}`,
      `context-targets:${bindings.length}`,
      `context-selection:${selection ? "yes" : "no"}`,
    ],
  };
}
