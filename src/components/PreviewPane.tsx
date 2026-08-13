import { useMemo } from "react";
import { useI18n } from "../i18n/context";
import { PdfPreview } from "./PdfPreview";
import type { PdfTextSelection } from "./pdfSelection";

type PreviewPaneProps = {
  compiling: boolean;
  compiled: boolean;
  onCompile: () => void;
  onFixWithAi?: () => void;
  title: string;
  authors: string;
  /** Object URL or data URL for compiled PDF */
  pdfUrl?: string | null;
  compileFailed?: boolean;
  onPdfTextSelection?: (selection: PdfTextSelection) => void;
};

export function PreviewPane({
  compiling,
  compiled,
  onCompile,
  onFixWithAi,
  title,
  authors,
  pdfUrl,
  compileFailed,
  onPdfTextSelection,
}: PreviewPaneProps) {
  const { t } = useI18n();
  const pages = useMemo(
    () => [
      {
        key: "p1",
        body: (
          <>
            <h1 className="paper-title">{title}</h1>
            <p className="paper-authors">{authors}</p>
            <h2>Abstract</h2>
            <p>
              <strong>Background. </strong>
              Early risk stratification in sepsis remains challenging in busy emergency
              departments.
            </p>
            <p>
              <strong>Methods. </strong>
              We conducted a retrospective cohort study of adults meeting Sepsis-3 criteria who
              presented between January 2022 and December 2024. The primary exposure was admission
              lactate; the primary outcome was 28-day mortality.
            </p>
            <p>
              <strong>Results. </strong>
              Among 1,284 patients, admission lactate ≥ 4 mmol/L was associated with higher 28-day
              mortality (adjusted HR 2.14, 95% CI 1.61–2.84).
            </p>
            <p>
              <strong>Conclusions. </strong>
              Admission lactate provides incremental prognostic information beyond qSOFA and may
              support earlier escalation of care.
            </p>
          </>
        ),
      },
      {
        key: "p2",
        body: (
          <>
            <h2>Methods</h2>
            <h3>Study design and setting</h3>
            <p>
              This retrospective cohort study was performed at a tertiary academic medical center.
              The protocol was approved by the institutional review board with a waiver of informed
              consent.
            </p>
            <h3>Statistical analysis</h3>
            <p>
              We estimated adjusted hazard ratios using Cox proportional hazards models, controlling
              for age, sex, Charlson comorbidity index, and source of infection.
            </p>
            <span className="eq">h(t) = h₀(t) exp(β₁ Lactate≥4 + β₂ Age + β₃ CCI + …)</span>
            <h2>Results</h2>
            <p>
              Of 1,542 screened encounters, 1,284 met inclusion criteria. Median age was 64 years
              (IQR 52–74); 41% were female. Overall 28-day mortality was 18.6%.
            </p>
            <p className="muted">Figure 1 · ROC curve placeholder</p>
          </>
        ),
      },
    ],
    [title, authors],
  );

  const pageW = 420;
  const pageH = 594;

  return (
    <section className="panel panel-preview">
      {!compiled && !compiling && (
        <div className="compile-banner">
          <p>
            <strong>{t("preview.sourceChanged")}</strong> {t("preview.compileRefresh")}
          </p>
          <button className="btn btn-secondary" type="button" onClick={onCompile}>
            {t("preview.compile")}
          </button>
        </div>
      )}

      {compileFailed && !compiling && (
        <div className="compile-banner">
          <p>
            <strong>{t("workspace.toastCompileFailed")}</strong>
          </p>
          {onFixWithAi && (
            <button className="btn btn-secondary" type="button" onClick={onFixWithAi}>
              {t("preview.fixWithAi")}
            </button>
          )}
        </div>
      )}

      <div className="preview-stage" aria-label={t("preview.title")}>
        {pdfUrl ? (
          <PdfPreview
            title={t("preview.pdfReady")}
            pdfUrl={pdfUrl}
            onTextSelection={onPdfTextSelection}
          />
        ) : (
          <div className="pdf-scroll-column" style={{ width: `${pageW}px` }}>
            {pages.map((page) => (
              <div
                key={page.key}
                className="pdf-page-shell"
                style={{ width: `${pageW}px`, height: `${pageH}px` }}
              >
                <article className="paper pdf-page">{page.body}</article>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
