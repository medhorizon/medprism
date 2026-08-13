export type PdfSelectionRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PdfSelectionPage = {
  pageNumber: number;
  width: number;
  height: number;
  pdfWidth: number;
  pdfHeight: number;
  rects: PdfSelectionRect[];
};

export type PdfTextSelection = {
  text: string;
  pages: PdfSelectionPage[];
};

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export function rectWithinPage(rect: Rect, page: Rect): PdfSelectionRect | null {
  const left = Math.max(rect.left, page.left);
  const top = Math.max(rect.top, page.top);
  const right = Math.min(rect.right, page.right);
  const bottom = Math.min(rect.bottom, page.bottom);
  if (right <= left || bottom <= top) return null;

  return {
    left: left - page.left,
    top: top - page.top,
    width: right - left,
    height: bottom - top,
  };
}
