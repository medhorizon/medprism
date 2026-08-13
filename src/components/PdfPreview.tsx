import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  GlobalWorkerOptions,
  getDocument,
  TextLayer,
  type PDFPageProxy,
} from "pdfjs-dist";
import { rectWithinPage, type PdfTextSelection } from "./pdfSelection";

type PdfPageStyle = CSSProperties & {
  "--scale-factor": number;
  "--user-unit": number;
  "--total-scale-factor": number;
  "--scale-round-x": string;
  "--scale-round-y": string;
};

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export type PdfPreviewProps = {
  pdfUrl?: string;
  bytes?: Uint8Array;
  title?: string;
  onTextSelection?: (selection: PdfTextSelection) => void;
};

type PdfPageProps = {
  page: PDFPageProxy;
  availableWidth: number;
  zoom: number;
};

function PdfPage({ page, availableWidth, zoom }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const baseViewport = page.getViewport({ scale: 1 });
  const fitScale = availableWidth / baseViewport.width;
  const scale = Math.max(0.25, Math.min(4, fitScale * zoom));
  const viewport = page.getViewport({ scale });
  const style: PdfPageStyle = {
    width: viewport.width,
    height: viewport.height,
    "--scale-factor": scale,
    "--user-unit": 1,
    "--total-scale-factor": scale,
    "--scale-round-x": "1px",
    "--scale-round-y": "1px",
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const textContainer = textLayerRef.current;
    if (!canvas || !textContainer) return;

    const outputScale = window.devicePixelRatio || 1;
    const context = canvas.getContext("2d");
    if (!context) return;

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    textContainer.replaceChildren();

    const renderTask = page.render({
      canvas,
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
    });
    const textLayer = new TextLayer({
      textContentSource: page.streamTextContent(),
      container: textContainer,
      viewport,
    });
    void renderTask.promise.catch(() => undefined);
    void textLayer.render().catch(() => undefined);

    return () => {
      renderTask.cancel();
      textLayer.cancel();
    };
  }, [page, viewport.height, viewport.width, scale]);

  return (
    <div
      className="pdfjs-page"
      data-pdf-page={page.pageNumber}
      data-pdf-width={baseViewport.width}
      data-pdf-height={baseViewport.height}
      style={style}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      <div ref={textLayerRef} className="pdfjs-text-layer" />
    </div>
  );
}

export function PdfPreview({ pdfUrl, bytes, title = "PDF preview", onTextSelection }: PdfPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const zoomAnchorRef = useRef<{
    pageNumber: string;
    pageX: number;
    pageY: number;
    pointerX: number;
    pointerY: number;
  } | null>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 600));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const zoomWithWheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !root.contains(event.target as Node)) return;
      event.preventDefault();
      const page = (event.target as Element).closest<HTMLElement>("[data-pdf-page]");
      if (page) {
        const pageBounds = page.getBoundingClientRect();
        const rootBounds = root.getBoundingClientRect();
        zoomAnchorRef.current = {
          pageNumber: page.dataset.pdfPage!,
          pageX: (event.clientX - pageBounds.left) / pageBounds.width,
          pageY: (event.clientY - pageBounds.top) / pageBounds.height,
          pointerX: event.clientX - rootBounds.left,
          pointerY: event.clientY - rootBounds.top,
        };
      }
      const factor = Math.exp(-event.deltaY * 0.002);
      setZoom((current) => Math.max(0.5, Math.min(4, current * factor)));
    };
    window.addEventListener("wheel", zoomWithWheel, { capture: true, passive: false });
    return () => window.removeEventListener("wheel", zoomWithWheel, { capture: true });
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const anchor = zoomAnchorRef.current;
    if (!root || !anchor) return;
    zoomAnchorRef.current = null;
    const page = root.querySelector<HTMLElement>(`[data-pdf-page="${anchor.pageNumber}"]`);
    if (!page) return;
    const pageBounds = page.getBoundingClientRect();
    const rootBounds = root.getBoundingClientRect();
    root.scrollLeft += pageBounds.left + pageBounds.width * anchor.pageX - rootBounds.left - anchor.pointerX;
    root.scrollTop += pageBounds.top + pageBounds.height * anchor.pageY - rootBounds.top - anchor.pointerY;
  }, [zoom]);

  useEffect(() => {
    if (!pdfUrl && !bytes) {
      setPages([]);
      return;
    }

    let disposed = false;
    setError(null);
    setPages([]);
    const task = getDocument(pdfUrl ? { url: pdfUrl } : { data: bytes!.slice() });
    void task.promise
      .then(async (loaded) => {
        if (disposed) return loaded.destroy();
        const loadedPages = await Promise.all(
          Array.from({ length: loaded.numPages }, (_, index) => loaded.getPage(index + 1)),
        );
        if (!disposed) setPages(loadedPages);
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : "Unable to load PDF");
      });

    return () => {
      disposed = true;
      void task.destroy();
    };
  }, [bytes, pdfUrl]);

  function reportSelection() {
    if (!onTextSelection || !rootRef.current) return;
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!selection || !text || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const selectionRects = Array.from(range.getClientRects());
    const selectedPages = Array.from(rootRef.current.querySelectorAll<HTMLElement>("[data-pdf-page]"))
      .map((page) => {
        const bounds = page.getBoundingClientRect();
        const rects = selectionRects
          .map((rect) => rectWithinPage(rect, bounds))
          .filter((rect) => rect !== null);
        return {
          pageNumber: Number(page.dataset.pdfPage),
          width: bounds.width,
          height: bounds.height,
          pdfWidth: Number(page.dataset.pdfWidth),
          pdfHeight: Number(page.dataset.pdfHeight),
          rects,
        };
      })
      .filter((page) => page.rects.length > 0);

    if (selectedPages.length > 0) onTextSelection({ text, pages: selectedPages });
  }

  return (
    <div
      ref={rootRef}
      className="pdfjs-preview"
      aria-label={title}
      onMouseUp={reportSelection}
    >
      {error ? <p className="pdfjs-message" role="alert">{error}</p> : null}
      {!error && pages.length === 0 ? <p className="pdfjs-message">Loading PDF...</p> : null}
      {pages.map((page) => (
        <PdfPage
          key={page.pageNumber}
          page={page}
          availableWidth={Math.max(200, width - 32)}
          zoom={zoom}
        />
      ))}
    </div>
  );
}
