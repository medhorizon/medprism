import { LangSwitch } from "./LangSwitch";
import { useI18n } from "../i18n/context";

type TopbarProps = {
  projectName: string;
  compiling: boolean;
  compiled: boolean;
  aiOpen: boolean;
  onToggleAssistant: () => void;
  onExport: () => void;
  onCompile: () => void;
  onCancelCompile?: () => void;
  onProjectClick?: () => void;
  onApiSettings?: () => void;
};

export function Topbar({
  projectName,
  compiling,
  compiled,
  aiOpen,
  onToggleAssistant,
  onExport,
  onCompile,
  onCancelCompile,
  onProjectClick,
  onApiSettings,
}: TopbarProps) {
  const { t } = useI18n();

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">M</div>
        <div className="brand-name">MedPrism</div>
      </div>
      <button
        className="project-chip"
        type="button"
        title={t("topbar.switchProject")}
        onClick={onProjectClick}
      >
        <span>{projectName}</span>
      </button>

      <div className="topbar-spacer" />
      <div className="status-pill" aria-live="polite">
        <span className={`status-dot ${compiled ? "ok" : "warn"}`} />
        {compiling
          ? t("topbar.compiling")
          : compiled
            ? t("topbar.pdfReady")
            : t("topbar.sourceChanged")}
      </div>

      <LangSwitch />
      <div className="topbar-actions">
        {onApiSettings && (
          <button className="btn btn-ghost" type="button" onClick={onApiSettings}>
            {t("topbar.apiSettings")}
          </button>
        )}
        <button
          className="btn btn-ghost"
          type="button"
          aria-pressed={aiOpen}
          onClick={onToggleAssistant}
        >
          {t("topbar.assistant")}
        </button>
        <button className="btn btn-secondary" type="button" onClick={onExport}>
          {t("topbar.export")}
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={compiling ? onCancelCompile : onCompile}
          disabled={compiling && !onCancelCompile}
        >
          {compiling ? t("common.cancel") : t("topbar.compile")}
        </button>
      </div>
    </header>
  );
}
