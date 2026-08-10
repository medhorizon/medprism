import { useEffect, useId, useRef, useState } from "react";
import { LangSwitch } from "./LangSwitch";
import { useI18n } from "../i18n/context";

type TopbarProps = {
  projectName: string;
  compiling: boolean;
  compiled: boolean;
  aiOpen: boolean;
  autoCompile: boolean;
  onToggleAssistant: () => void;
  onExport: () => void;
  onCompile: () => void;
  onCancelCompile?: () => void;
  onToggleAutoCompile: () => void;
  onProjectClick?: () => void;
  onApiSettings?: () => void;
};

export function Topbar({
  projectName,
  compiling,
  compiled,
  aiOpen,
  autoCompile,
  onToggleAssistant,
  onExport,
  onCompile,
  onCancelCompile,
  onToggleAutoCompile,
  onProjectClick,
  onApiSettings,
}: TopbarProps) {
  const { t } = useI18n();
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const flyoutId = useId();

  useEffect(() => {
    if (!flyoutOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!groupRef.current?.contains(event.target as Node)) {
        setFlyoutOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setFlyoutOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [flyoutOpen]);

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
        <div
          className={`compile-control${flyoutOpen || autoCompile ? " is-open" : ""}`}
          ref={groupRef}
          onMouseEnter={() => setFlyoutOpen(true)}
          onMouseLeave={() => {
            if (!autoCompile) setFlyoutOpen(false);
          }}
        >
          {(flyoutOpen || autoCompile) && (
            <button
              id={flyoutId}
              className="btn btn-primary compile-flyout"
              type="button"
              aria-pressed={autoCompile}
              title={t("topbar.autoCompileHint")}
              onClick={onToggleAutoCompile}
            >
              {t("topbar.autoCompile")}
            </button>
          )}
          <button
            className="btn btn-primary"
            type="button"
            aria-haspopup="true"
            aria-expanded={flyoutOpen || autoCompile}
            aria-controls={flyoutId}
            onClick={compiling ? onCancelCompile : onCompile}
            onFocus={() => setFlyoutOpen(true)}
            disabled={compiling && !onCancelCompile}
          >
            {compiling ? t("common.cancel") : t("topbar.compile")}
          </button>
        </div>
      </div>
    </header>
  );
}
