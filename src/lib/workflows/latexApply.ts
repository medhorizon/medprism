import type { ContextSnapshot } from "../context/snapshot";
import { buildLatexTextPatch, resolveLatexTarget } from "../latex/textTargets";
import type {
  LatexDraftFormat,
  LatexTargetSpec,
  ResolvedLatexTarget,
} from "../latex/types";
import { hydratePatchProposal } from "../patch/hydrate";
import type {
  ModelPatchProposal,
  PatchSet,
  PatchValidationError,
} from "../patch/schema";
import { validatePatchSet } from "../patch/validate";

export type FinalizeLatexPatchResult =
  | { ok: true; patchSet: PatchSet; renderedText?: string; plainText?: string }
  | { ok: false; error: PatchValidationError };

function invalid(message: string): FinalizeLatexPatchResult {
  return { ok: false, error: { code: "INVALID_PATCH", message } };
}

/** Central validation gate for every runtime-owned PatchSet. */
export async function finalizePatchSet(
  snapshot: ContextSnapshot,
  patchSet: PatchSet,
): Promise<FinalizeLatexPatchResult> {
  const validated = await validatePatchSet({ ...snapshot.files }, patchSet);
  return validated.ok
    ? { ok: true, patchSet }
    : { ok: false, error: validated.error };
}

/** Convert a local model proposal into trusted runtime metadata, then validate it. */
export async function finalizeModelPatchProposal(args: {
  snapshot: ContextSnapshot;
  proposal: ModelPatchProposal;
  strictSelection: boolean;
  allowedPaths: string[];
  forceCompileVerification?: boolean;
}): Promise<FinalizeLatexPatchResult> {
  const hydrated = await hydratePatchProposal(args.proposal, args.snapshot, {
    strictSelection: args.strictSelection,
    allowedPaths: args.allowedPaths,
    forceCompileVerification: args.forceCompileVerification === true,
  });
  if (!hydrated.ok) return { ok: false, error: hydrated.error };
  return finalizePatchSet(args.snapshot, hydrated.patchSet);
}

/** Build and validate a PatchSet for a target already resolved by trusted code. */
export async function finalizeResolvedTextDraft(args: {
  snapshot: ContextSnapshot;
  target: ResolvedLatexTarget;
  text: string;
  format: LatexDraftFormat;
  summary: string;
}): Promise<FinalizeLatexPatchResult> {
  const built = await buildLatexTextPatch({
    snapshot: args.snapshot,
    target: args.target,
    text: args.text,
    format: args.format,
    summary: args.summary,
  });
  if (!built.ok) return invalid(built.message);
  const finalized = await finalizePatchSet(args.snapshot, built.patchSet);
  return finalized.ok
    ? {
        ...finalized,
        renderedText: built.renderedText,
        plainText: built.plainText,
      }
    : finalized;
}

/** Resolve a runtime-owned target, build a PatchSet, and validate it. */
export async function finalizeTextDraft(args: {
  snapshot: ContextSnapshot;
  target: LatexTargetSpec;
  text: string;
  format: LatexDraftFormat;
  summary: string;
}): Promise<FinalizeLatexPatchResult> {
  const resolved = resolveLatexTarget(args.snapshot, args.target);
  if (!resolved.ok) return invalid(resolved.message);
  return finalizeResolvedTextDraft({
    snapshot: args.snapshot,
    target: resolved.target,
    text: args.text,
    format: args.format,
    summary: args.summary,
  });
}
