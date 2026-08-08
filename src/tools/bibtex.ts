import type { PaperHit } from "./types";

/** Deterministic BibTeX from structured PaperHit (never invents DOI/PMID). */
export function paperHitToBibtex(hit: PaperHit): string {
  const key = citeKey(hit);
  const authors = hit.authors || "Unknown";
  const title = escapeBib(hit.title);
  const year = hit.year || "n.d.";
  const journal = hit.journal ? `  journal = {${escapeBib(hit.journal)}},\n` : "";
  const doi = hit.doi ? `  doi = {${escapeBib(hit.doi)}},\n` : "";
  const pmid = hit.pmid ? `  note = {PMID: ${escapeBib(hit.pmid)}},\n` : "";
  const eprint = hit.pmid
    ? `  eprint = {${escapeBib(hit.pmid)}},\n  eprinttype = {pubmed},\n`
    : "";

  return (
    `@article{${key},\n` +
    `  author = {${escapeBib(authors)}},\n` +
    `  title = {${title}},\n` +
    journal +
    `  year = {${escapeBib(year)}},\n` +
    doi +
    pmid +
    eprint +
    `}`
  );
}

export function citeKey(hit: PaperHit): string {
  const firstAuthor =
    (hit.authors.split(/[,;]/)[0] ?? "anon")
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 24) || "anon";
  const year = hit.year && /^\d{4}/.test(hit.year) ? hit.year.slice(0, 4) : "nd";
  const slug = hit.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 12);
  const idPart = hit.pmid || (hit.doi ? hit.doi.replace(/[^A-Za-z0-9]/g, "").slice(-8) : slug);
  return `${firstAuthor}${year}_${idPart}`.replace(/[^A-Za-z0-9_]/g, "");
}

function escapeBib(value: string): string {
  return value.replace(/[{}]/g, "");
}
