import type { ContextSnapshot } from "../context/snapshot";
import type { PatchSet, ReplaceTextOperation, SourceRange } from "../patch/schema";
import { simulatePatchSet } from "../patch/simulate";
import { sha256Hex } from "../patch/hash";
import {
  buildLatexTextPatch,
  resolveLatexTarget,
} from "./textTargets";
import type { LatexTargetSpec } from "./types";
import {
  DEFAULT_SUBMISSION_SCAFFOLD,
  parseScaffoldModules,
} from "./scaffoldModules";

export { DEFAULT_SUBMISSION_SCAFFOLD, parseScaffoldModules } from "./scaffoldModules";
export type { ScaffoldModuleParseResult } from "./scaffoldModules";

export type ScaffoldBuildResult =
  | {
      ok: true;
      patchSet: PatchSet;
      added: string[];
      skipped: string[];
      parseSource: "checklist" | "mentions" | "default" | "explicit";
    }
  | { ok: false; message: string };

function labelFor(spec: LatexTargetSpec): string {
  if (spec.kind === "section") return spec.sectionTitle?.trim() || "Section";
  const titles: Record<string, string> = {
    title: "Title",
    abstract: "Abstract",
    keywords: "keywords",
    introduction: "Introduction",
    methods: "Methods",
    results: "Results",
    discussion: "Discussion",
    conclusion: "Conclusion",
    funding: "Funding",
    acknowledgements: "Acknowledgements",
    "conflict-of-interest": "Competing interests",
    ethics: "Ethics approval",
    "data-availability": "Data availability",
    "author-contributions": "Author contributions",
  };
  return titles[spec.kind] ?? spec.kind;
}

function alreadyPresent(spec: LatexTargetSpec, snapshot: ContextSnapshot): boolean {
  const resolved = resolveLatexTarget(snapshot, {
    ...spec,
    createIfMissing: false,
  });
  return resolved.ok && resolved.target.mode === "replace_body";
}

function shellDraft(spec: LatexTargetSpec): {
  text: string;
  format: "plain-text" | "latex-body";
} {
  if (spec.kind === "keywords") {
    return { text: "[keyword1, keyword2, keyword3]", format: "plain-text" };
  }
  if (spec.kind === "title") {
    return { text: "[Title]", format: "plain-text" };
  }
  return { text: "", format: "latex-body" };
}

function extractInsertBlock(
  op: ReplaceTextOperation,
): { mode: "before" | "after"; block: string } | null {
  const anchor = op.oldText;
  if (!anchor) return null;
  if (op.newText.endsWith(anchor) && op.newText.length > anchor.length) {
    return { mode: "before", block: op.newText.slice(0, -anchor.length) };
  }
  const afterPrefix = `${anchor}\n\n`;
  if (op.newText.startsWith(afterPrefix) && op.newText.length > afterPrefix.length) {
    return { mode: "after", block: op.newText.slice(afterPrefix.length) };
  }
  if (op.newText.startsWith(anchor) && op.newText.length > anchor.length) {
    return { mode: "after", block: op.newText.slice(anchor.length).replace(/^\n+/, "") };
  }
  return null;
}

/**
 * Collapse inserts that share path+anchor into one replace_text, all against the
 * original file hashes/ranges. Apply later ranges first so earlier offsets stay valid.
 */
async function assembleScaffoldOperations(
  steps: ReplaceTextOperation[],
  originalFiles: Record<string, string>,
): Promise<ReplaceTextOperation[]> {
  type Group = {
    path: string;
    oldText: string;
    mode: "before" | "after";
    blocks: string[];
    range: SourceRange;
  };
  const groups = new Map<string, Group>();

  for (const op of steps) {
    const extracted = extractInsertBlock(op);
    if (!extracted || !op.range) continue;
    const key = `${op.path}\0${extracted.mode}\0${op.oldText}\0${op.range.start}`;
    const existing = groups.get(key);
    if (existing) {
      existing.blocks.push(extracted.block);
    } else {
      groups.set(key, {
        path: op.path,
        oldText: op.oldText,
        mode: extracted.mode,
        blocks: [extracted.block],
        range: op.range,
      });
    }
  }

  const assembled: ReplaceTextOperation[] = [];
  for (const group of [...groups.values()].sort(
    (a, b) => b.range.start - a.range.start,
  )) {
    const source = originalFiles[group.path] ?? "";
    const combined = group.blocks.join("");
    const newText =
      group.mode === "before"
        ? `${combined}${group.oldText}`
        : `${group.oldText}\n\n${combined}`;
    assembled.push({
      op: "replace_text",
      path: group.path,
      baseSha256: await sha256Hex(source),
      oldText: group.oldText,
      newText,
      expectedOccurrences: 1,
      range: group.range,
    });
  }
  return assembled;
}

/**
 * Build a Keep-ready PatchSet that inserts missing structural shells.
 * No model ops are involved — placement uses trusted LaTeX target resolution.
 */
export async function buildStructuralScaffoldPatch(
  snapshot: ContextSnapshot,
  modules: LatexTargetSpec[] = DEFAULT_SUBMISSION_SCAFFOLD,
  parseSource: "checklist" | "mentions" | "default" | "explicit" = "explicit",
): Promise<ScaffoldBuildResult> {
  const stepOps: ReplaceTextOperation[] = [];
  const added: string[] = [];
  const skipped: string[] = [];

  for (const spec of modules) {
    if (alreadyPresent(spec, snapshot)) {
      skipped.push(labelFor(spec));
      continue;
    }

    const resolved = resolveLatexTarget(snapshot, {
      ...spec,
      createIfMissing: true,
    });
    if (!resolved.ok) {
      skipped.push(`${labelFor(spec)} (${resolved.message})`);
      continue;
    }
    if (resolved.target.mode === "replace_body") {
      skipped.push(labelFor(spec));
      continue;
    }

    const draft = shellDraft(spec);
    const built = await buildLatexTextPatch({
      snapshot,
      target: resolved.target,
      text: draft.text,
      format: draft.format,
      summary: `Add empty ${labelFor(spec)} shell`,
    });
    if (!built.ok) {
      skipped.push(`${labelFor(spec)} (${built.message})`);
      continue;
    }

    const op = built.patchSet.operations[0];
    if (!op || op.op !== "replace_text") {
      skipped.push(labelFor(spec));
      continue;
    }

    stepOps.push(op);
    added.push(labelFor(spec));
  }

  if (stepOps.length === 0) {
    return {
      ok: false,
      message:
        skipped.length > 0
          ? `No new scaffold modules were needed (already present or unresolved: ${skipped.join(", ")}).`
          : "No scaffold modules were selected.",
    };
  }

  const operations = await assembleScaffoldOperations(stepOps, snapshot.files);
  const patchSet: PatchSet = {
    schemaVersion: "1",
    id: crypto.randomUUID(),
    projectRevision: snapshot.projectRevision,
    summary: `Insert ${added.length} empty manuscript module shell(s)`,
    operations,
    verify: { compile: true },
  };

  const verified = await simulatePatchSet(snapshot.files, patchSet);
  if (!verified.ok) {
    return {
      ok: false,
      message: `Scaffold patch failed validation: ${verified.error.message}`,
    };
  }

  return {
    ok: true,
    added,
    skipped,
    parseSource,
    patchSet,
  };
}

/** Parse the user request, then build a runtime-owned scaffold PatchSet. */
export async function buildScaffoldFromUserText(
  snapshot: ContextSnapshot,
  userText: string,
): Promise<ScaffoldBuildResult> {
  const parsed = parseScaffoldModules(userText);
  return buildStructuralScaffoldPatch(snapshot, parsed.modules, parsed.source);
}
