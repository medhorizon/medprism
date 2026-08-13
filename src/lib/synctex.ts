import type { PdfTextSelection } from "../components/pdfSelection";
import type { SyncTexSourceCandidate } from "./pdfSourceLocation";

type SyncTexPoint = SyncTexSourceCandidate & { page: number; x: number; y: number };
const SYNCTEX_UNIT = 65_781.76;

export function parseSyncTexPoints(source: string): SyncTexPoint[] {
  const files = new Map<number, string>();
  const points: SyncTexPoint[] = [];
  let page = 0;
  for (const line of source.split(/\r?\n/)) {
    const input = line.match(/^Input:(\d+):(.+)$/);
    if (input) {
      files.set(Number(input[1]), input[2]!);
      continue;
    }
    const opened = line.match(/^\{(\d+)$/);
    if (opened) {
      page = Number(opened[1]);
      continue;
    }
    if (/^\}\d+$/.test(line)) {
      page = 0;
      continue;
    }
    const point = line.match(/^[hvkxg]?(\d+),(\d+):(-?\d+),(-?\d+)/);
    if (!point || !page) continue;
    const path = files.get(Number(point[1]));
    if (!path) continue;
    points.push({ path, line: Number(point[2]), page, x: Number(point[3]) / SYNCTEX_UNIT, y: Number(point[4]) / SYNCTEX_UNIT });
  }
  return points;
}

export function syncTexCandidatesForSelection(source: string, selection: PdfTextSelection): SyncTexSourceCandidate[] {
  const ranked: Array<{ candidate: SyncTexSourceCandidate; distance: number }> = [];
  for (const selectedPage of selection.pages) {
    for (const rect of selectedPage.rects) {
      const x = (rect.left + rect.width / 2) * selectedPage.pdfWidth / selectedPage.width;
      const y = (rect.top + rect.height / 2) * selectedPage.pdfHeight / selectedPage.height;
      for (const point of parseSyncTexPoints(source)) {
        if (point.page !== selectedPage.pageNumber) continue;
        ranked.push({ candidate: { path: point.path, line: point.line }, distance: Math.hypot(point.x - x, point.y - y) });
      }
    }
  }
  const seen = new Set<string>();
  return ranked.sort((a, b) => a.distance - b.distance).map(({ candidate }) => candidate).filter((candidate) => {
    const key = `${candidate.path}:${candidate.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}

export async function decodeSyncTexBase64(base64: string): Promise<string> {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}
