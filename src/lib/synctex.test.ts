import { describe, expect, it } from "vitest";
import { parseSyncTexPoints, syncTexCandidatesForSelection } from "./synctex";

const source = ["SyncTeX Version:1", "Input:1:C:\\tmp\\main.tex", "Content:", "{1", "h1,12:6578176,13156352:100,0,0", "h1,24:19734528,26312704:100,0,0", "}1"].join("\n");

describe("SyncTeX selection mapping", () => {
  it("parses source points with page and line metadata", () => {
    const points = parseSyncTexPoints(source);
    expect(points.map(({ path, line, page }) => ({ path, line, page }))).toEqual([
      { path: "C:\\tmp\\main.tex", line: 12, page: 1 },
      { path: "C:\\tmp\\main.tex", line: 24, page: 1 },
    ]);
    expect(points[0]!.x).toBeCloseTo(100);
    expect(points[0]!.y).toBeCloseTo(200);
  });

  it("ranks the closest source line to the PDF selection", () => {
    const candidates = syncTexCandidatesForSelection(source, { text: "selected", pages: [{ pageNumber: 1, width: 612, height: 792, pdfWidth: 612, pdfHeight: 792, rects: [{ left: 90, top: 190, width: 20, height: 20 }] }] });
    expect(candidates[0]).toEqual({ path: "C:\\tmp\\main.tex", line: 12 });
  });
});
