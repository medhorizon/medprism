import { chatCompletions } from "../llmClient";
import { runTool } from "../../tools/registry";
import { runCitationWorkflow } from "./citation";
import { runCompileFixWorkflow } from "./compileFix";
import { runReviewWorkflow } from "./review";
import { runWritingWorkflow } from "./writing";
import {
  emptyAgentResult,
  type WorkflowExecutionInput,
  type WorkflowHandler,
  type WorkflowKind,
  type WorkflowResult,
  type WorkflowServices,
} from "./types";

export type ExecuteWorkflowInput = Omit<WorkflowExecutionInput, "services">;

const HANDLERS: Record<WorkflowKind, WorkflowHandler> = {
  writing: runWritingWorkflow,
  polish: runWritingWorkflow,
  citation: runCitationWorkflow,
  latex: runWritingWorkflow,
  "compile-fix": runCompileFixWorkflow,
  review: runReviewWorkflow,
};

const DEFAULT_SERVICES: WorkflowServices = {
  complete: chatCompletions,
  runTool,
};

function rejectedResult(kind: WorkflowKind, message: string): WorkflowResult {
  return {
    agent: emptyAgentResult(kind, "Workflow result failed runtime validation", [message]),
    content: message,
    toolNotes: [],
  };
}

/** Last safety gate before a workflow result reaches the UI. */
export function validateWorkflowResult(
  expected: WorkflowKind,
  result: WorkflowResult,
): WorkflowResult {
  if (result.agent.schemaVersion !== "1" || result.agent.workflow !== expected) {
    return rejectedResult(expected, `Workflow returned mismatched result metadata for ${expected}`);
  }
  if (expected === "review" && result.agent.patch) {
    return rejectedResult(expected, "Review workflow must never return a PatchSet");
  }
  if (expected !== "review" && result.agent.review) {
    return rejectedResult(expected, `${expected} workflow returned an unexpected ReviewReport`);
  }
  if (expected !== "citation" && result.agent.citationPlan) {
    return rejectedResult(expected, `${expected} workflow returned an unexpected CitationPlan`);
  }
  if (
    expected === "compile-fix" &&
    result.agent.patch &&
    result.agent.patch.verify?.compile !== true
  ) {
    return rejectedResult(expected, "Compile-fix PatchSet must require compile verification");
  }
  return result;
}

export async function executeWorkflow(
  input: ExecuteWorkflowInput,
  services: WorkflowServices = DEFAULT_SERVICES,
): Promise<WorkflowResult> {
  const handler = HANDLERS[input.request.kind];
  const result = await handler({ ...input, services });
  return validateWorkflowResult(input.request.kind, result);
}

export function listWorkflows(): WorkflowKind[] {
  return Object.keys(HANDLERS) as WorkflowKind[];
}
