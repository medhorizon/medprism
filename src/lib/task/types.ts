import type { ManuscriptSlotKind } from "../manuscript/types";

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
  messageSegmentIds: string[];
};

export type TaskSpec = {
  schemaVersion: "1";
  action: TaskAction;
  applyMode: TaskApplyMode;
  contentMode: TaskContentMode;
  scope: TaskScope;
  evidenceMode: TaskEvidenceMode;
  targets: TaskTarget[];
};

export type MessageSegment = {
  id: string;
  start: number;
  end: number;
  text: string;
};

export type InterpretedTask = {
  spec: TaskSpec;
  segments: MessageSegment[];
  source: "llm" | "locked" | "safe-fallback";
  repaired: boolean;
  warning?: string;
};
