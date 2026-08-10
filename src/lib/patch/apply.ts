import { sha256Hex } from "./hash";
import { projectRevision } from "./revision";
import type {
  FileSnapshot,
  PatchSet,
  PatchValidationError,
} from "./schema";
import { simulatePatchSet, type PatchSimulation } from "./simulate";

export type ApplyPatchResult =
  | { ok: true; simulation: PatchSimulation }
  | { ok: false; error: PatchValidationError };

/** Apply is intentionally only a simulation result; the caller commits it with CAS. */
export async function applyPatchSet(
  files: Record<string, string>,
  patchSet: PatchSet,
): Promise<ApplyPatchResult> {
  return simulatePatchSet(files, patchSet);
}

export type UndoPatchResult =
  | { ok: true; files: Record<string, string>; projectRevision: string }
  | { ok: false; error: PatchValidationError };

export async function undoPatchSet(
  files: Record<string, string>,
  snapshots: Record<string, FileSnapshot>,
  postApplyHashes: Record<string, string>,
): Promise<UndoPatchResult> {
  for (const path of Object.keys(snapshots)) {
    const expected = postApplyHashes[path];
    const current = files[path];
    if (!expected || current === undefined || (await sha256Hex(current)) !== expected) {
      return {
        ok: false,
        error: {
          code: "BASE_MISMATCH",
          message: `Cannot undo because ${path} changed after the patch was applied`,
          path,
        },
      };
    }
  }

  const next = { ...files };
  for (const [path, snapshot] of Object.entries(snapshots)) {
    if (snapshot.existed) next[path] = snapshot.content;
    else delete next[path];
  }
  return { ok: true, files: next, projectRevision: await projectRevision(next) };
}
