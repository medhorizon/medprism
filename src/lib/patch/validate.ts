import type { PatchSet, PatchValidationError } from "./schema";
import { simulatePatchSet, type PatchSimulation } from "./simulate";

export type ValidatePatchResult =
  | { ok: true; simulation: PatchSimulation }
  | { ok: false; error: PatchValidationError };

/** Single source of truth: validation, preview, and apply all use one simulation. */
export async function validatePatchSet(
  files: Record<string, string>,
  patchSet: PatchSet,
): Promise<ValidatePatchResult> {
  return simulatePatchSet(files, patchSet);
}
