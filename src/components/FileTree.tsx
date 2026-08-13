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
  onAddImage: () => void;
};

export function FileTree({
  files,
  activeFileId,
  onSelect,
  accountLabel,
  onAccountClick,
  onApiSettings,
  onAddImage,
}: FileTreeProps) {
  const { t } = useI18n();

  return (
    <aside className="panel panel-files">
      <div className="panel-head">
        <span>{t("files.title")}</span>
        <button
          className="icon-btn"
          type="button"
          title={t("files.addImage")}
          aria-label={t("files.addImage")}
          onClick={onAddImage}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M8 3v10M3 8h10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
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
                    ? file.name.split(".").pop()?.toLowerCase() || "asset"
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
