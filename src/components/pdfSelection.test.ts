import { describe, expect, it } from "vitest";
import { rectWithinPage } from "./pdfSelection";

describe("rectWithinPage", () => {
  const page = { left: 100, top: 200, right: 500, bottom: 800 };

  it("converts viewport coordinates to page-local coordinates", () => {
    expect(rectWithinPage({ left: 120, top: 230, right: 180, bottom: 250 }, page)).toEqual({
      left: 20,
      top: 30,
      width: 60,
      height: 20,
    });
  });

  it("clips a selection rectangle at the page boundary", () => {
    expect(rectWithinPage({ left: 90, top: 190, right: 130, bottom: 220 }, page)).toEqual({
      left: 0,
      top: 0,
      width: 30,
      height: 20,
    });
  });

  it("ignores rectangles outside the page", () => {
    expect(rectWithinPage({ left: 10, top: 20, right: 30, bottom: 40 }, page)).toBeNull();
  });
});
