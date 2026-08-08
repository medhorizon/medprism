import type { ChatMessage } from "../types/chat";

export function replyFor(prompt: string): ChatMessage {
  const lower = prompt.toLowerCase();

  if (lower.includes("compile") || lower.includes("diagnos") || lower.includes("warning")) {
    return {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "Compile log is clean for the active file set. One soft warning remains: figure `roc_curve.pdf` is referenced but not yet included in Results. I can insert a figure environment after the mortality paragraph.",
      suggestion: {
        title: "Suggested insert · sections/results.tex",
        body: `\\begin{figure}[ht]
  \\centering
  \\includegraphics[width=0.72\\linewidth]{figures/roc_curve.pdf}
  \\caption{ROC curve for admission lactate predicting 28-day mortality.}
  \\label{fig:roc}
\\end{figure}`,
      },
    };
  }

  if (lower.includes("citation") || lower.includes("sepsis-3") || lower.includes("cite")) {
    return {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "I'll anchor the Sepsis-3 definition to Singer et al., 2016 and keep Surviving Sepsis Campaign 2021 for management context. Suggested Methods edit below.",
      suggestion: {
        title: "Suggested edit · sections/methods.tex",
        body: `Adults ($\\geq 18$ years) who met Sepsis-3 criteria
\\citep{singer2016} within 6 hours of arrival were eligible.`,
      },
    };
  }

  if (lower.includes("causal") || lower.includes("result")) {
    return {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "Current Results imply causality (“provides incremental prognostic information”). For an observational cohort, prefer association language and keep adjusted estimates explicit.",
      suggestion: {
        title: "Suggested rewrite · sections/results.tex",
        body: `After adjustment for age, sex, comorbidity, and infection source,
admission lactate $\\geq 4$~mmol/L remained associated with
28-day mortality (adjusted HR 2.14, 95\\% CI 1.61--2.84).`,
      },
    };
  }

  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content:
      "Here is a tighter Abstract conclusion that stays within the study design and avoids overclaiming clinical utility.",
    suggestion: {
      title: "Suggested rewrite · sections/abstract.tex",
      body: `\\textbf{Conclusions.}
In this single-center cohort, higher admission lactate was independently
associated with 28-day mortality and may aid early risk stratification
when interpreted alongside clinical scores.`,
    },
  };
}
