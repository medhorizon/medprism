import { useEffect, useRef, useState, type ChangeEvent, type SyntheticEvent } from "react";
import { useI18n } from "../i18n/context";
import type { TextSelection } from "../lib/context/snapshot";
import { decodeBinaryFile, isBinaryFileContent } from "../lib/projectBinary";

type SourcePaneProps = {
  fileName: string;
  value: string;
  onChange: (value: string) => void;
  onSelectionChange?: (selection?: TextSelection) => void;
  onCursorChange?: (cursor: number) => void;
  revealSelection?: TextSelection;
  onFixWithAi: () => void;
};

export function SourcePane({
  fileName,
  value,
  onChange,
  onSelectionChange,
  onCursorChange,
  revealSelection,
  onFixWithAi,
}: SourcePaneProps) {
  const { t } = useI18n();
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const imageFile = ["png", "jpg", "jpeg"].includes(extension);
  const binary = imageFile || isBinaryFileContent(value) || extension === "pdf";
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !revealSelection) return;
    editor.focus();
    editor.setSelectionRange(revealSelection.start, revealSelection.end);
    const line = value.slice(0, revealSelection.start).split("\n").length;
    const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 20;
    editor.scrollTop = Math.max(0, (line - 3) * lineHeight);
  }, [fileName, revealSelection, value]);

  useEffect(() => {
    if (!imageFile) {
      setImageUrl(null);
      return;
    }
    const bytes = decodeBinaryFile(value);
    if (!bytes) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: extension === "png" ? "image/png" : "image/jpeg" }),
    );
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [extension, imageFile, value]);

  function reportSelection(event: SyntheticEvent<HTMLTextAreaElement>) {
    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    onCursorChange?.(end);
    onSelectionChange?.(start === end ? undefined : { start, end });
  }

  function change(event: ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.target.value);
    onSelectionChange?.();
    onCursorChange?.(event.target.selectionStart);
  }

  return (
    <div className="source-pane">
      <div className="panel-head">
        <span>{t("source.title")}</span>
        <div className="panel-head-actions">
          <button
            className="icon-btn"
            type="button"
            title={t("source.fixAi")}
            onClick={onFixWithAi}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M8 2.5v11M3.5 8h9"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <div className="editor-wrap">
        <div className="editor-meta">
          <strong>{fileName}</strong>
          {binary ? <span>· {imageFile ? extension.toUpperCase() : "PDF"}</span> : <span>· UTF-8</span>}
          {binary ? null : <span>· LaTeX</span>}
        </div>
        {binary ? (
          imageFile && imageUrl ? (
            <div className="editor editor-binary editor-image">
              <img src={imageUrl} alt={fileName} />
            </div>
          ) : (
            <div className="editor editor-binary">{t("source.binaryPdf")}</div>
          )
        ) : (
          <textarea
            ref={editorRef}
            className="editor"
            spellCheck={false}
            value={value}
            onChange={change}
            onSelect={reportSelection}
            onKeyUp={reportSelection}
            onMouseUp={reportSelection}
          />
        )}
      </div>
    </div>
  );
}
