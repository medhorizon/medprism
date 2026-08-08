export const PROJECT_NAME = "Sepsis Biomarker Cohort Study";
export const DEMO_PROJECT_ID = "demo-sepsis";

export const SOURCE: Record<string, string> = {
  "main.tex": `\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{booktabs}
\\usepackage{graphicx}
\\usepackage{amsmath}
\\usepackage[numbers]{natbib}

\\title{Admission Lactate and Early Mortality in Adult Sepsis:\\
A Single-Center Cohort Study}
\\author{MedPrism Collaborative\\\\Department of Critical Care Medicine}
\\date{}

\\begin{document}
\\maketitle

\\input{sections/abstract}
\\input{sections/methods}
\\input{sections/results}

\\bibliographystyle{plainnat}
\\bibliography{references}
\\end{document}
`,
  "sections/abstract.tex": `\\section*{Abstract}
\\textbf{Background.}
Early risk stratification in sepsis remains challenging in busy emergency departments.

\\textbf{Methods.}
We conducted a retrospective cohort study of adults meeting Sepsis-3 criteria
who presented between January 2022 and December 2024.
The primary exposure was admission lactate; the primary outcome was 28-day mortality.

\\textbf{Results.}
Among 1{,}284 patients, admission lactate $\\geq 4$~mmol/L was associated with
higher 28-day mortality (adjusted HR 2.14, 95\\% CI 1.61--2.84).

\\textbf{Conclusions.}
Admission lactate provides incremental prognostic information beyond qSOFA
and may support earlier escalation of care.
`,
  "sections/methods.tex": `\\section{Methods}
\\subsection{Study design and setting}
This retrospective cohort study was performed at a tertiary academic medical center.
The protocol was approved by the institutional review board with a waiver of informed consent.

\\subsection{Population}
Adults ($\\geq 18$ years) who met Sepsis-3 criteria within 6 hours of arrival
were eligible. Transfer patients and those with missing lactate values were excluded.

\\subsection{Statistical analysis}
We estimated adjusted hazard ratios using Cox proportional hazards models,
controlling for age, sex, Charlson comorbidity index, and source of infection.
`,
  "sections/results.tex": `\\section{Results}
Of 1{,}542 screened encounters, 1{,}284 met inclusion criteria.
Median age was 64 years (IQR 52--74); 41\\% were female.
Overall 28-day mortality was 18.6\\%.

Patients with lactate $\\geq 4$~mmol/L had higher crude mortality
(34.2\\% vs 12.8\\%, $p < 0.001$).
The model C-statistic was 0.79 (95\\% CI 0.76--0.82).
`,
  "references.bib": `@article{singer2016,
  title={The Third International Consensus Definitions for Sepsis and Septic Shock (Sepsis-3)},
  author={Singer, M. and others},
  journal={JAMA},
  year={2016},
  volume={315},
  number={8},
  pages={801--810}
}

@article{evans2021,
  title={Surviving Sepsis Campaign: International Guidelines for Management of Sepsis and Septic Shock 2021},
  author={Evans, L. and others},
  journal={Critical Care Medicine},
  year={2021},
  volume={49},
  number={11},
  pages={e1063--e1143}
}
`,
  "figures/roc_curve.pdf": "% Binary asset placeholder — ROC curve figure\n",
};

/** Demo-only chat seeds live in i18n (`assistant.demo.*`); generic projects use `assistant.*`. */