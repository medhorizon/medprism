import { useI18n } from "../i18n/context";
import type { ProjectFile } from "../types/chat";

type FileTreeProps = {
  files: ProjectFile[];
  activeFileId: string;
  onSelect: (id: string) => void;
  /** Left label of the account footer: login CTA or email when signed in */
  accountLabel: string;
  onAccountClick: () => void;
  onApiSettings: () => void;
};

export function FileTree({
  files,
  activeFileId,
  onSelect,
  accountLabel,
  onAccountClick,
  onApiSettings,
}: FileTreeProps) {
  const { t } = useI18n();

  return (
    <aside className="panel panel-files">
      <div className="panel-head">
        <span>{t("files.title")}</span>
      </div>
      <div className="file-list">
        {files.map((file) => (
          <button
            key={file.id}
            type="button"
            className={`file-item ${activeFileId === file.id ? "active" : ""}`}
            onClick={() => onSelect(file.id)}
          >
            <span className="file-ext">
              {file.kind === "bib"
                ? "bib"
                : file.kind === "cls"
                  ? "cls"
                  : file.kind === "asset"
                    ? "pdf"
                    : "tex"}
            </span>
            <span className="file-name">{file.name}</span>
          </button>
        ))}
      </div>
      <div className="files-account-bar">
        <button
          className="files-account-btn"
          type="button"
          title={accountLabel}
          onClick={onAccountClick}
        >
          <span className="files-account-label">{accountLabel}</span>
        </button>
        <span className="files-account-sep" aria-hidden>
          |
        </span>
        <button
          className="files-account-btn"
          type="button"
          onClick={onApiSettings}
        >
          {t("common.apiSettings")}
        </button>
      </div>
    </aside>
  );
}
