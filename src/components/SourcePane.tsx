import { useI18n } from "../i18n/context";

type SourcePaneProps = {
  fileName: string;
  value: string;
  onChange: (value: string) => void;
  onFixWithAi: () => void;
};

export function SourcePane({ fileName, value, onChange, onFixWithAi }: SourcePaneProps) {
  const { t } = useI18n();

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
          <span>· UTF-8</span>
          <span>· LaTeX</span>
        </div>
        <textarea
          className="editor"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}
