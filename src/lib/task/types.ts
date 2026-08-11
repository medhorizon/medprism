import type { ManuscriptSlotKind } from "../manuscript/types";
import type { ConversationArtifact } from "../../types/chat";

export type TaskAction =
  | "advice"
  | "draft"
  | "polish"
  | "scaffold"
  | "fill-sections"
  | "cite"
  | "review"
  | "research"
  | "latex"
  | "compile-fix";

export type TaskApplyMode = "answer-only" | "propose-patch";
export type TaskContentMode = "none" | "generate" | "provided" | "blank";
export type TaskScope =
  | "selection"
  | "targets"
  | "active-file"
  | "manuscript"
  | "compile-log";
export type TaskEvidenceMode = "none" | "literature";

export type TaskTarget = {
  slot: ManuscriptSlotKind | "custom-section";
  title?: string;
  sourceIds: string[];
};

export type TaskSpec = {
  schemaVersion: "2";
  action: TaskAction;
  applyMode: TaskApplyMode;
  contentMode: TaskContentMode;
  scope: TaskScope;
  evidenceMode: TaskEvidenceMode;
  targets: TaskTarget[];
};

export type InterpretedTask = {
  sources: ConversationArtifact[];
} & (
  | {
      ok: true;
      spec: TaskSpec;
      source: "llm" | "locked" | "runtime";
      repaired: boolean;
      targetSelections?: Array<{
        targetIndex: number;
        occurrenceId: string;
      }>;
    }
  | {
      ok: false;
      source: "invalid";
      repaired: true;
      error: string;
  }
);

export type SuccessfulInterpretedTask = Extract<InterpretedTask, { ok: true }>;
