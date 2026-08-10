import type { StructuredBibEntry } from "../lib/patch/schema";
import type { PaperHit } from "./types";

function escapeBib(value: string): string {
  const escaped = [...value].map((character) => {
    if (character === "\\") return "{\\textbackslash}";
    if ("{}%&#_$".includes(character)) return `\\${character}`;
    return character;
  }).join("");
  return escaped.replace(/\s+/g, " ").trim();
}

function resemblesSurnameInitials(value: string): boolean {
  return /^\p{L}[\p{L}'’.-]*(?:\s+[A-Z](?:[A-Z.-]*))+(?:\s+(?:Jr\.?|Sr\.?|II|III|IV))?$/u.test(
    value.trim(),
  );
}

function normalizeAuthors(value: string): string {
  const explicit = value
    .split(/\s*;\s*|\s+\band\b\s+/i)
    .map((author) => author.trim())
    .filter(Boolean);
  if (explicit.length > 1) return explicit.join(" and ");

  // Europe PMC commonly returns "Smith J, Jones A". Keep the BibTeX-valid
  // single-author form "Smith, John" intact unless every comma segment has
  // the surname+initials shape.
  const commaSeparated = value
    .split(/\s*,\s*/)
    .map((author) => author.trim())
    .filter(Boolean);
  if (commaSeparated.length > 1 && commaSeparated.every(resemblesSurnameInitials)) {
    return commaSeparated.join(" and ");
  }
  return value.trim();
}

export function normalizeDoi(value?: string): string | undefined {
  const normalized = value
    ?.trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
  if (!normalized || !/^10\.\d{4,9}\/\S+$/i.test(normalized)) return undefined;
  return normalized;
}

export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function asciiKeyToken(value: string, fallback: string): string {
  const token = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "");
  return token || fallback;
}

function firstAuthorToken(authors: string): string {
  const first = authors.split(/\s*(?:;|\band\b)\s*/i)[0]?.trim() || "Anon";
  const beforeComma = first.split(",")[0]?.trim() || first;
  if (first.includes(",")) return asciiKeyToken(beforeComma, "Anon");
  const words = beforeComma.split(/\s+/).filter(Boolean);
  const last = words.at(-1) ?? "";
  const surname = /^[A-Z.-]{1,5}$/i.test(last) && words.length > 1 ? words[0]! : last;
  return asciiKeyToken(surname, "Anon");
}

function firstTitleToken(title: string): string {
  const word = normalizeTitle(title)
    .split(" ")
    .find((candidate) => candidate.length >= 4 && !/^(with|from|that|this|using|study)$/i.test(candidate));
  return asciiKeyToken(word ?? "", "Paper");
}

export function baseCiteKey(hit: PaperHit): string {
  const year = asciiKeyToken(hit.year || "ND", "ND");
  return `${firstAuthorToken(hit.authors)}${year}${firstTitleToken(hit.title)}`;
}

export function allocateCiteKey(hit: PaperHit, occupied: Set<string>): string {
  const base = baseCiteKey(hit);
  let candidate = base;
  let suffix = 0;
  while (occupied.has(candidate.toLowerCase())) {
    suffix += 1;
    candidate = `${base}${suffix <= 26 ? String.fromCharCode(96 + suffix) : suffix}`;
  }
  occupied.add(candidate.toLowerCase());
  return candidate;
}

export type BibliographyIndex = {
  keys: Set<string>;
  byDoi: Map<string, string>;
  byPmid: Map<string, string>;
  byTitle: Map<string, string>;
};

function fieldValue(entry: string, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return entry.match(new RegExp(`\\b${escaped}\\s*=\\s*[{\"]([^}\"]+)[}\"]`, "i"))?.[1]?.trim();
}

export function indexBibliography(bib: string): BibliographyIndex {
  const result: BibliographyIndex = {
    keys: new Set<string>(),
    byDoi: new Map<string, string>(),
    byPmid: new Map<string, string>(),
    byTitle: new Map<string, string>(),
  };
  const starts = [...bib.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/gi)];
  for (let index = 0; index < starts.length; index += 1) {
    const match = starts[index]!;
    const key = match[1]!;
    const start = match.index ?? 0;
    const end = starts[index + 1]?.index ?? bib.length;
    const entry = bib.slice(start, end);
    result.keys.add(key.toLowerCase());

    const doi = normalizeDoi(fieldValue(entry, "doi"));
    if (doi && !result.byDoi.has(doi)) result.byDoi.set(doi, key);

    const eprintType = fieldValue(entry, "eprinttype")?.toLowerCase();
    const eprint = fieldValue(entry, "eprint");
    const notePmid = entry.match(/PMID\s*:\s*(\d+)/i)?.[1];
    const pmid = (eprintType === "pubmed" ? eprint : undefined) ?? notePmid;
    if (pmid && !result.byPmid.has(pmid.trim())) result.byPmid.set(pmid.trim(), key);

    const title = fieldValue(entry, "title");
    const normalized = title ? normalizeTitle(title) : "";
    if (normalized && !result.byTitle.has(normalized)) result.byTitle.set(normalized, key);
  }
  return result;
}

export function existingCiteKeys(bib: string): Set<string> {
  return indexBibliography(bib).keys;
}

export function existingCiteKeyForHit(hit: PaperHit, index: BibliographyIndex): string | undefined {
  const doi = normalizeDoi(hit.doi);
  if (doi) {
    const key = index.byDoi.get(doi);
    if (key) return key;
  }
  const pmid = hit.pmid?.trim();
  if (pmid) {
    const key = index.byPmid.get(pmid);
    if (key) return key;
  }
  const title = normalizeTitle(hit.title);
  return title ? index.byTitle.get(title) : undefined;
}

export function paperHitToStructuredBibEntry(
  hit: PaperHit,
  citeKey: string,
): StructuredBibEntry {
  const fields: string[] = [];
  const authors = normalizeAuthors(hit.authors);
  if (authors) fields.push(`  author = {${escapeBib(authors)}}`);
  fields.push(`  title = {${escapeBib(hit.title)}}`);
  if (hit.journal?.trim()) fields.push(`  journal = {${escapeBib(hit.journal)}}`);
  if (hit.year?.trim()) fields.push(`  year = {${escapeBib(hit.year)}}`);
  const doi = normalizeDoi(hit.doi);
  if (doi) fields.push(`  doi = {${escapeBib(doi)}}`);
  const pmid = hit.pmid?.trim();
  const verifiedPmid = pmid && /^\d+$/.test(pmid) ? pmid : undefined;
  if (verifiedPmid) {
    fields.push(`  eprint = {${escapeBib(verifiedPmid)}}`);
    fields.push("  eprinttype = {pubmed}");
    fields.push(`  note = {PMID: ${escapeBib(verifiedPmid)}}`);
  }
  return {
    citeKey,
    bibtex: `@article{${citeKey},\n${fields.join(",\n")}\n}`,
    ...(doi ? { doi } : {}),
    ...(verifiedPmid ? { pmid: verifiedPmid } : {}),
    normalizedTitle: normalizeTitle(hit.title),
  };
}

/** Compatibility helpers. New citation workflow allocates against the existing bibliography. */
export function citeKey(hit: PaperHit): string {
  return baseCiteKey(hit);
}

export function paperHitToBibtex(hit: PaperHit): string {
  const key = citeKey(hit);
  return paperHitToStructuredBibEntry(hit, key).bibtex;
}
