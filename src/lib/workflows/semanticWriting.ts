import type { ContextSnapshot } from "../context/snapshot";
import type { ResolvedTask, ResolvedTargetBinding } from "../context/resolver";
import { escapeLatexPlainText, locateLatexCommands, structuralMask } from "../latex/targets";
import { renderFilledSlot } from "../manuscript/profiles";
import { displayHeading, slotOrder } from "../manuscript/slots";
import { sha256Hex } from "../patch/hash";
import type { PatchSet, ReplaceTextOperation } from "../patch/schema";
import { simulatePatchSet } from "../patch/simulate";
import { finalizePatchSet } from "./latexApply";
import { emptyAgentResult, type WorkflowResult } from "./types";

type SemanticPatchBuild =
  | { ok: true; patchSet: PatchSet; applied: string[]; skipped: string[] }
  | { ok: false; message: string };

export function repairProvidedText(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  const paragraphs = normalized.split(/\n\s*\n/);
  return paragraphs
    .map((paragraph) =>
      paragraph
        .replace(/(\p{L})-\n(\p{L})/gu, "$1$2")
        .replace(/(\p{L})\n(?=\p{Ll})/gu, "$1")
        .replace(/\s*\n\s*/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}

function stripHeadingPrefix(text: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return text
    .replace(new RegExp(`^${escaped}\\s*[:：-]\\s*`, "i"), "")
    .trim();
}

function replacementText(binding: ResolvedTargetBinding, plain: string): string {
  const occurrence = binding.occurrence!;
  const escaped = escapeLatexPlainText(plain);
  if (occurrence.syntax === "environment") return `\n${escaped}\n`;
  if (occurrence.syntax === "section") return `\n${escaped}\n\n`;
  return escaped;
}

function shortTitleFrom(title: string): string {
  const compact = title.replace(/\s+/g, " ").trim();
  const clause = compact.split(/[:.?!—–]/u)[0]?.trim() || compact;
  if (clause.length <= 60) return clause;
  const sliced = clause.slice(0, 57).replace(/\s+\S*$/, "").trim();
  return `${sliced || clause.slice(0, 57)}...`;
}

async function buildOperations(
  snapshot: ContextSnapshot,
  resolved: ResolvedTask,
  mode: "scaffold" | "fill-sections",
): Promise<SemanticPatchBuild> {
  if (resolved.errors.length > 0) return { ok: false, message: resolved.errors.join(" ") };
  const applied: string[] = [];
  const skipped: string[] = [];
  const operations: ReplaceTextOperation[] = [];
  const insertionGroups = new Map<string, ResolvedTargetBinding[]>();

  for (const binding of resolved.targets) {
    const heading = displayHeading(binding.ref);
    if (binding.occurrence) {
      if (mode === "scaffold") {
        skipped.push(heading);
        continue;
      }
      const repaired = repairProvidedText(binding.providedText);
      const body = stripHeadingPrefix(repaired, heading);
      if (!body) {
        skipped.push(`${heading} (empty provided text)`);
        continue;
      }
      const source = snapshot.files[binding.occurrence.path];
      if (source === undefined) return { ok: false, message: `Missing source file ${binding.occurrence.path}.` };
      const range = binding.occurrence.bodyRange;
      let oldText = source.slice(range.start, range.end);
      let newText = replacementText(binding, body);
      let operationRange = range;
      if (binding.ref.slot === "title" && binding.occurrence.syntax === "command") {
        const titleCommand = locateLatexCommands(source, structuralMask(source), "title")
          .find((command) => command.commandStart === binding.occurrence!.wrapperRange.start);
        if (titleCommand?.optionalArg !== undefined) {
          operationRange = binding.occurrence.wrapperRange;
          oldText = source.slice(operationRange.start, operationRange.end);
          newText = `\\title[${escapeLatexPlainText(shortTitleFrom(body))}]{${escapeLatexPlainText(body)}}`;
        }
      }
      if (!oldText) {
        const wrapper = binding.occurrence.wrapperRange;
        oldText = source.slice(wrapper.start, wrapper.end);
        newText = renderFilledSlot(resolved.model.profile, binding.ref, escapeLatexPlainText(body)).text.trimEnd();
        operationRange = wrapper;
      }
      operations.push({
        op: "replace_text",
        path: binding.occurrence.path,
        baseSha256: await sha256Hex(source),
        oldText,
        newText,
        expectedOccurrences: 1,
        range: operationRange,
      });
      applied.push(heading);
      continue;
    }

    if (!binding.insertion) {
      skipped.push(`${heading} (no insertion point)`);
      continue;
    }
    const key = `${binding.insertion.path}:${binding.insertion.at}`;
    insertionGroups.set(key, [...(insertionGroups.get(key) ?? []), binding]);
  }

  for (const group of insertionGroups.values()) {
    const first = group[0]!.insertion!;
    const source = snapshot.files[first.path];
    if (source === undefined || first.at >= source.length) {
      return { ok: false, message: `Insertion point is unavailable in ${first.path}.` };
    }
    const ordered = [...group].sort((a, b) => slotOrder(a.ref) - slotOrder(b.ref));
    const blocks: string[] = [];
    for (const binding of ordered) {
      const heading = displayHeading(binding.ref);
      if (mode === "scaffold") {
        blocks.push(binding.insertion!.text);
      } else {
        const repaired = repairProvidedText(binding.providedText);
        const body = stripHeadingPrefix(repaired, heading);
        if (!body) {
          skipped.push(`${heading} (empty provided text)`);
          continue;
        }
        blocks.push(
          renderFilledSlot(
            resolved.model.profile,
            binding.ref,
            escapeLatexPlainText(body),
          ).text,
        );
      }
      applied.push(heading);
    }
    if (blocks.length === 0) continue;
    const anchorEnd = Math.min(source.length, first.at + 120);
    const oldText = source.slice(first.at, anchorEnd);
    operations.push({
      op: "replace_text",
      path: first.path,
      baseSha256: await sha256Hex(source),
      oldText,
      newText: `${blocks.join("")}${oldText}`,
      expectedOccurrences: 1,
      range: { start: first.at, end: anchorEnd },
    });
  }

  operations.sort((a, b) =>
    a.path.localeCompare(b.path) || (b.range?.start ?? 0) - (a.range?.start ?? 0),
  );
  if (operations.length === 0) {
    return { ok: false, message: skipped.length ? `No changes were required (${skipped.join(", ")}).` : "No semantic targets were resolved." };
  }
  const patchSet: PatchSet = {
    schemaVersion: "1",
    id: crypto.randomUUID(),
    projectRevision: snapshot.projectRevision,
    summary: mode === "scaffold" ? "Create manuscript scaffold" : "Fill manuscript sections",
    operations,
    verify: { compile: true },
  };
  const simulated = await simulatePatchSet({ ...snapshot.files }, patchSet);
  if (!simulated.ok) return { ok: false, message: simulated.error.message };
  return { ok: true, patchSet, applied, skipped };
}

export async function runSemanticWriting(
  snapshot: ContextSnapshot,
  resolved: ResolvedTask,
): Promise<WorkflowResult | null> {
  if (resolved.spec.action !== "scaffold" && resolved.spec.action !== "fill-sections") return null;
  const built = await buildOperations(snapshot, resolved, resolved.spec.action);
  if (!built.ok) {
    return {
      agent: emptyAgentResult("writing", "Semantic writing could not be applied", [built.message]),
      content: built.message,
      toolNotes: [...resolved.toolNotes, `semantic-writing:error:${built.message}`],
    };
  }
  const finalized = await finalizePatchSet(snapshot, built.patchSet);
  if (!finalized.ok) {
    return {
      agent: emptyAgentResult("writing", "Semantic writing validation failed", [finalized.error.message]),
      content: finalized.error.message,
      toolNotes: [...resolved.toolNotes, "semantic-writing:validation-failed"],
    };
  }
  return {
    agent: {
      schemaVersion: "1",
      workflow: "writing",
      summary: built.patchSet.summary,
      warnings: [
        ...resolved.warnings,
        ...(built.skipped.length ? [`Skipped: ${built.skipped.join(", ")}`] : []),
      ],
      patch: finalized.patchSet,
    },
    content: `${built.patchSet.summary}: ${built.applied.join(", ")}. Review the Diff before Keep.`,
    toolNotes: [
      ...resolved.toolNotes,
      `semantic-writing:${resolved.spec.action}:${built.applied.length}`,
    ],
  };
}
