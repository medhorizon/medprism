import type { ChangeEvent, SyntheticEvent } from "react";
import { useI18n } from "../i18n/context";
import type { TextSelection } from "../lib/context/snapshot";
import { isBinaryFileContent } from "../lib/projectBinary";

type SourcePaneProps = {
  fileName: string;
  value: string;
  onChange: (value: string) => void;
  onSelectionChange?: (selection?: TextSelection) => void;
  onFixWithAi: () => void;
};

export function SourcePane({
  fileName,
  value,
  onChange,
  onSelectionChange,
  onFixWithAi,
}: SourcePaneProps) {
  const { t } = useI18n();
  const binary = isBinaryFileContent(value) || fileName.toLowerCase().endsWith(".pdf");

  function reportSelection(event: SyntheticEvent<HTMLTextAreaElement>) {
    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    onSelectionChange?.(start === end ? undefined : { start, end });
  }

  function change(event: ChangeEvent<HTMLTextAreaElement>) {
    onChange(event.target.value);
    // Typing changes offsets; never retain a range from the previous buffer.
    onSelectionChange?.();
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
          {binary ? <span>· PDF</span> : <span>· UTF-8</span>}
          {binary ? null : <span>· LaTeX</span>}
        </div>
        {binary ? (
          <div className="editor editor-binary">{t("source.binaryPdf")}</div>
        ) : (
          <textarea
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
