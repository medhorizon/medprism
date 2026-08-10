import type { ContextSnapshot } from "../context/snapshot";
import {
  locateLatexCommands,
  structuralMask,
} from "../latex/targets";
import { canonicalScore, detectTemplateProfile } from "./profiles";
import {
  displayHeading,
  matchHeading,
  normalizeHeading,
  slotKey,
} from "./slots";
import type {
  ManuscriptDiagnostic,
  ManuscriptModel,
  ManuscriptOccurrence,
  ManuscriptSlotRef,
  StructuralNode,
} from "./types";

type LocatedEnvironment = {
  start: number;
  bodyStart: number;
  bodyEnd: number;
  end: number;
};

function preferredMainFile(snapshot: ContextSnapshot): string {
  if (snapshot.mainFile && snapshot.files[snapshot.mainFile] !== undefined) return snapshot.mainFile;
  if (snapshot.activeFile.toLowerCase().endsWith(".tex")) return snapshot.activeFile;
  return Object.keys(snapshot.files).find((path) => path.toLowerCase().endsWith(".tex")) ?? snapshot.activeFile;
}

function occurrenceId(path: string, ref: ManuscriptSlotRef, start: number): string {
  return `slot:${encodeURIComponent(path)}:${slotKey(ref)}:${start}`;
}

function structuralId(path: string, kind: StructuralNode["kind"], start: number): string {
  return `node:${encodeURIComponent(path)}:${kind}:${start}`;
}

function locateEnvironment(masked: string, name: string): LocatedEnvironment[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const begin = new RegExp(`\\\\begin\\s*\\{\\s*${escaped}\\s*\\}`, "gi");
  const end = new RegExp(`\\\\end\\s*\\{\\s*${escaped}\\s*\\}`, "gi");
  const found: LocatedEnvironment[] = [];
  for (const match of masked.matchAll(begin)) {
    if (match.index === undefined) continue;
    const bodyStart = match.index + match[0].length;
    end.lastIndex = bodyStart;
    const closing = end.exec(masked);
    if (!closing) continue;
    found.push({
      start: match.index,
      bodyStart,
      bodyEnd: closing.index,
      end: closing.index + closing[0].length,
    });
  }
  return found;
}

function pushCommandOccurrences(
  out: ManuscriptOccurrence[],
  path: string,
  source: string,
  masked: string,
  command: string,
  ref: ManuscriptSlotRef,
) {
  for (const located of locateLatexCommands(source, masked, command)) {
    out.push({
      id: occurrenceId(path, ref, located.commandStart),
      ref,
      path,
      syntax: "command",
      heading: displayHeading(ref),
      bodyRange: { start: located.bodyStart, end: located.bodyEnd },
      wrapperRange: { start: located.commandStart, end: located.commandEnd },
      body: source.slice(located.bodyStart, located.bodyEnd),
      canonical: false,
      duplicate: false,
    });
  }
}

function pushEnvironmentOccurrences(
  out: ManuscriptOccurrence[],
  path: string,
  source: string,
  masked: string,
  name: string,
  ref: ManuscriptSlotRef,
) {
  for (const located of locateEnvironment(masked, name)) {
    out.push({
      id: occurrenceId(path, ref, located.start),
      ref,
      path,
      syntax: "environment",
      heading: displayHeading(ref),
      bodyRange: { start: located.bodyStart, end: located.bodyEnd },
      wrapperRange: { start: located.start, end: located.end },
      body: source.slice(located.bodyStart, located.bodyEnd),
      canonical: false,
      duplicate: false,
    });
  }
}

function sectionOccurrences(path: string, source: string, masked: string): ManuscriptOccurrence[] {
  const commands = [
    ...locateLatexCommands(source, masked, "section", { allowStar: true }),
    ...locateLatexCommands(source, masked, "bmhead"),
  ].sort((a, b) => a.commandStart - b.commandStart);
  const boundaryPattern = /\\(?:bibliography|begin\s*\{\s*thebibliography\s*\}|end\s*\{\s*document\s*\})/gi;
  const boundary = [...masked.matchAll(boundaryPattern)]
    .map((match) => match.index ?? source.length)
    .sort((a, b) => a - b)[0] ?? source.length;
  const out: ManuscriptOccurrence[] = [];
  for (let index = 0; index < commands.length; index += 1) {
    const located = commands[index]!;
    const title = source.slice(located.bodyStart, located.bodyEnd).trim();
    if (normalizeHeading(title) === "declarations") continue;
    const ref = matchHeading(title);
    const bodyEnd = Math.min(commands[index + 1]?.commandStart ?? boundary, boundary);
    out.push({
      id: occurrenceId(path, ref, located.commandStart),
      ref,
      path,
      syntax: "section",
      heading: title,
      bodyRange: { start: located.commandEnd, end: Math.max(located.commandEnd, bodyEnd) },
      wrapperRange: { start: located.commandStart, end: Math.max(located.commandEnd, bodyEnd) },
      body: source.slice(located.commandEnd, Math.max(located.commandEnd, bodyEnd)),
      canonical: false,
      duplicate: false,
    });
  }
  return out;
}

function declarationOccurrences(path: string, source: string, masked: string): ManuscriptOccurrence[] {
  const declarations = [
    ...locateLatexCommands(source, masked, "section", { allowStar: true }),
    ...locateLatexCommands(source, masked, "bmhead"),
  ].find((command) => normalizeHeading(source.slice(command.bodyStart, command.bodyEnd)) === "declarations");
  if (!declarations) return [];
  const list = locateEnvironment(masked.slice(declarations.commandEnd), "itemize")[0];
  if (!list) return [];
  const offset = declarations.commandEnd;
  const listStart = offset + list.bodyStart;
  const listEnd = offset + list.bodyEnd;
  const listMasked = masked.slice(listStart, listEnd);
  const items = [...listMasked.matchAll(/\\item\b/gi)];
  const out: ManuscriptOccurrence[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const start = listStart + (item.index ?? 0);
    const commandEnd = start + item[0].length;
    const end = listStart + (items[index + 1]?.index ?? listMasked.length);
    const content = source.slice(commandEnd, end);
    const label = content.match(/^\s*([^:\n]{2,120}?)(?:\s*:\s*|\s*\r?\n)/)?.[1]?.trim();
    if (!label) continue;
    const ref = matchHeading(label);
    if (ref.slot === "custom-section") continue;
    const labelEndRelative = content.search(/:\s*|\r?\n/);
    const bodyStart = labelEndRelative >= 0
      ? commandEnd + labelEndRelative + (content.slice(labelEndRelative).match(/^:\s*|^\r?\n/)?.[0].length ?? 0)
      : commandEnd;
    let bodyEnd = end;
    while (bodyEnd > bodyStart && /\s/.test(source[bodyEnd - 1] ?? "")) bodyEnd -= 1;
    out.push({
      id: occurrenceId(path, ref, start),
      ref,
      path,
      syntax: "declaration-item",
      heading: label,
      bodyRange: { start: bodyStart, end: bodyEnd },
      wrapperRange: { start, end },
      body: source.slice(bodyStart, bodyEnd),
      canonical: false,
      duplicate: false,
    });
  }
  return out;
}

function structuralNodes(path: string, source: string, masked: string): StructuralNode[] {
  const definitions: Array<[StructuralNode["kind"], RegExp]> = [
    ["begin-document", /\\begin\s*\{\s*document\s*\}/gi],
    ["make-title", /\\maketitle\b/gi],
    ["author", /\\author\*?(?:\s*\[[^\]]*\])?\s*\{/gi],
    ["frontmatter-end", /\\end\s*\{\s*frontmatter\s*\}/gi],
    ["bibliography", /\\(?:bibliography\b|begin\s*\{\s*thebibliography\s*\})/gi],
    ["end-document", /\\end\s*\{\s*document\s*\}/gi],
  ];
  const out: StructuralNode[] = [];
  for (const [kind, pattern] of definitions) {
    const match = pattern.exec(masked);
    if (!match || match.index < 0) continue;
    out.push({
      id: structuralId(path, kind, match.index),
      kind,
      path,
      range: { start: match.index, end: match.index + match[0].length },
    });
  }

  const declarations = [
    ...locateLatexCommands(source, masked, "section", { allowStar: true }),
    ...locateLatexCommands(source, masked, "bmhead"),
  ].find((command) => normalizeHeading(source.slice(command.bodyStart, command.bodyEnd)) === "declarations");
  if (declarations) {
    const tail = masked.slice(declarations.commandEnd);
    const list = locateEnvironment(tail, "itemize")[0];
    if (list) {
      const start = declarations.commandEnd + list.bodyEnd;
      out.push({
        id: structuralId(path, "declarations-end", start),
        kind: "declarations-end",
        path,
        range: { start, end: start },
      });
    }
  }
  return out;
}

function canonicalize(
  occurrences: ManuscriptOccurrence[],
  modelProfile: ManuscriptModel["profile"],
  mainFile: string,
): ManuscriptDiagnostic[] {
  const groups = new Map<string, ManuscriptOccurrence[]>();
  for (const occurrence of occurrences) {
    const key = slotKey(occurrence.ref);
    groups.set(key, [...(groups.get(key) ?? []), occurrence]);
  }
  const diagnostics: ManuscriptDiagnostic[] = [];
  for (const [key, group] of groups) {
    group.sort((a, b) => canonicalScore(modelProfile, b, mainFile) - canonicalScore(modelProfile, a, mainFile));
    group.forEach((occurrence, index) => {
      occurrence.canonical = index === 0;
      occurrence.duplicate = group.length > 1 && index > 0;
    });
    if (group.length > 1) {
      diagnostics.push({
        code: "DUPLICATE_SLOT",
        message: `Multiple active occurrences were found for ${key}.`,
        occurrenceIds: group.map((occurrence) => occurrence.id),
      });
    }
  }
  return diagnostics;
}

export function buildManuscriptModel(snapshot: ContextSnapshot): ManuscriptModel {
  const mainFile = preferredMainFile(snapshot);
  const profile = detectTemplateProfile(snapshot.files);
  const occurrences: ManuscriptOccurrence[] = [];
  const nodes: StructuralNode[] = [];
  for (const [path, source] of Object.entries(snapshot.files)) {
    if (!path.toLowerCase().endsWith(".tex")) continue;
    const masked = structuralMask(source);
    pushCommandOccurrences(occurrences, path, source, masked, "title", { slot: "title" });
    pushCommandOccurrences(occurrences, path, source, masked, "abstract", { slot: "abstract" });
    pushEnvironmentOccurrences(occurrences, path, source, masked, "abstract", { slot: "abstract" });
    pushCommandOccurrences(occurrences, path, source, masked, "keywords", { slot: "keywords" });
    pushEnvironmentOccurrences(occurrences, path, source, masked, "keyword", { slot: "keywords" });
    pushEnvironmentOccurrences(occurrences, path, source, masked, "IEEEkeywords", { slot: "keywords" });
    occurrences.push(...sectionOccurrences(path, source, masked));
    occurrences.push(...declarationOccurrences(path, source, masked));
    nodes.push(...structuralNodes(path, source, masked));
  }
  const diagnostics = canonicalize(occurrences, profile, mainFile);
  return {
    projectRevision: snapshot.projectRevision,
    profile,
    mainFile,
    files: snapshot.files,
    occurrences,
    structuralNodes: nodes,
    diagnostics,
  };
}

export function canonicalOccurrence(
  model: ManuscriptModel,
  ref: ManuscriptSlotRef,
): ManuscriptOccurrence | undefined {
  return model.occurrences.find(
    (occurrence) => occurrence.canonical && slotKey(occurrence.ref) === slotKey(ref),
  );
}

export function occurrencesForSlot(
  model: ManuscriptModel,
  ref: ManuscriptSlotRef,
): ManuscriptOccurrence[] {
  return model.occurrences.filter(
    (occurrence) => slotKey(occurrence.ref) === slotKey(ref),
  );
}

export function manuscriptInventory(model: ManuscriptModel): Array<{
  id: string;
  slot: string;
  heading: string;
  path: string;
  canonical: boolean;
}> {
  return model.occurrences.map((occurrence) => ({
    id: occurrence.id,
    slot: slotKey(occurrence.ref),
    heading: occurrence.heading,
    path: occurrence.path,
    canonical: occurrence.canonical,
  }));
}
