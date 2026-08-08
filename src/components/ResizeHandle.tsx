import { useRef, type PointerEvent } from "react";

type ResizeHandleProps = {
  /** Drag right increases size; for right sidebar pass invert */
  invert?: boolean;
  onResize: (deltaPx: number) => void;
  label: string;
};

export function ResizeHandle({ invert = false, onResize, label }: ResizeHandleProps) {
  const lastX = useRef<number | null>(null);

  function onDown(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    lastX.current = e.clientX;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (lastX.current == null) return;
    const raw = e.clientX - lastX.current;
    lastX.current = e.clientX;
    onResize(invert ? -raw : raw);
  }

  function onUp() {
    lastX.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  );
}
