import { normalizeDoi, normalizeTitle } from "./bibtex";
import type { PaperHit } from "./types";

export function paperIdentityKeys(hit: Pick<PaperHit, "doi" | "pmid" | "title">): string[] {
  const keys: string[] = [];
  const doi = normalizeDoi(hit.doi);
  if (doi) keys.push(`doi:${doi}`);
  const pmid = hit.pmid?.trim();
  if (pmid && /^\d+$/.test(pmid)) keys.push(`pmid:${pmid}`);
  const title = normalizeTitle(hit.title);
  if (title) keys.push(`title:${title}`);
  return keys;
}

function withNormalizedDoi(hit: PaperHit): PaperHit {
  const doi = normalizeDoi(hit.doi);
  return doi ? { ...hit, doi } : hit;
}

function preferHit(existing: PaperHit, incoming: PaperHit): PaperHit {
  const incomingAbstract = incoming.abstract?.trim() ?? "";
  const existingAbstract = existing.abstract?.trim() ?? "";
  const incomingDoi = normalizeDoi(incoming.doi);
  return {
    ...existing,
    ...(incoming.pmid && !existing.pmid ? { pmid: incoming.pmid } : {}),
    ...(incomingDoi && !existing.doi ? { doi: incomingDoi } : {}),
    ...(incoming.year && !existing.year ? { year: incoming.year } : {}),
    ...(incoming.journal && !existing.journal ? { journal: incoming.journal } : {}),
    ...(incomingAbstract && incomingAbstract.length > existingAbstract.length
      ? { abstract: incoming.abstract }
      : {}),
    ...(incoming.authors && incoming.authors.length > existing.authors.length
      ? { authors: incoming.authors }
      : {}),
  };
}

function stableHitId(hit: PaperHit): string {
  return hit.pmid?.trim() || normalizeDoi(hit.doi) || hit.id;
}

/**
 * Interleave ranked lists, then collapse the same work (DOI, then PMID, then title)
 * into one record. Later copies fill missing metadata instead of creating a second row.
 */
export function mergeUniquePaperHits(groups: readonly PaperHit[][], limit: number): PaperHit[] {
  const cap = Math.max(0, limit);
  const byCanonical = new Map<string, PaperHit>();
  const aliasToCanonical = new Map<string, string>();
  const order: string[] = [];

  const canonicalFor = (hit: PaperHit): string | undefined => {
    for (const key of paperIdentityKeys(hit)) {
      const found = aliasToCanonical.get(key);
      if (found) return found;
    }
    return undefined;
  };

  const remember = (canonical: string, hit: PaperHit) => {
    for (const key of paperIdentityKeys(hit)) aliasToCanonical.set(key, canonical);
  };

  const maxLen = Math.max(0, ...groups.map((group) => group.length));
  for (let rank = 0; rank < maxLen; rank += 1) {
    for (const group of groups) {
      const hit = group[rank];
      if (!hit?.title.trim()) continue;
      const existingKey = canonicalFor(hit);
      if (existingKey) {
        const merged = preferHit(byCanonical.get(existingKey)!, hit);
        byCanonical.set(existingKey, merged);
        remember(existingKey, merged);
        continue;
      }
      const canonical = paperIdentityKeys(hit)[0] ?? `row:${order.length}`;
      const copy = withNormalizedDoi({ ...hit });
      byCanonical.set(canonical, copy);
      remember(canonical, copy);
      order.push(canonical);
    }
  }

  const seenIds = new Set<string>();
  const merged: PaperHit[] = [];
  for (const key of order) {
    if (merged.length >= cap) break;
    const hit = byCanonical.get(key);
    if (!hit) continue;
    const id = stableHitId(hit);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    merged.push({ ...hit, id });
  }
  return merged;
}
