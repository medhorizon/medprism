import type { OfficialTemplateSpec } from "./types";

/**
 * Official publisher template catalog.
 * Each id maps to a vendored folder under templates/official/<id>/.
 */
export const OFFICIAL_TEMPLATE_CATALOG: OfficialTemplateSpec[] = [
  {
    id: "springer-nature-sn-jnl",
    name: "Springer Nature Journal",
    publisher: "Springer Nature",
    description: "Official sn-jnl package with a Tectonic-ready starter (sn-article.tex).",
    tags: ["official", "journal", "springer-nature", "bundled"],
    downloadPage:
      "https://www.springernature.com/gp/authors/campaigns/latex-author-support",
    zipHint: "Bundled from Springer Nature Overleaf package v3.1 (Dec 2024).",
    mainCandidates: ["sn-article.tex"],
    licenseNote: "Vendored official package. Follow Springer Nature redistribution terms.",
  },
  {
    id: "elsevier-elsarticle",
    name: "Elsevier elsarticle",
    publisher: "Elsevier",
    description: "Official elsarticle journal class (CTAN), DocStrip-built for Tectonic.",
    tags: ["official", "journal", "elsevier", "bundled"],
    downloadPage: "https://ctan.org/pkg/elsarticle",
    zipHint: "Bundled from CTAN elsarticle.",
    mainCandidates: [
      "elsarticle-template-num.tex",
      "elsarticle-template-harv.tex",
      "elsarticle-template-num-names.tex",
    ],
    licenseNote: "LPPL (elsarticle). Vendored from CTAN for offline project creation.",
  },
  {
    id: "ieee-journal",
    name: "IEEE Journal (IEEEtran)",
    publisher: "IEEE",
    description: "Official IEEEtran journal / transactions template package (CTAN).",
    tags: ["official", "journal", "ieee", "bundled"],
    downloadPage: "https://ctan.org/pkg/ieeetran",
    zipHint: "Bundled from CTAN IEEEtran.",
    mainCandidates: ["bare_jrnl.tex", "bare_jrnl_compsoc.tex", "bare_conf.tex"],
    licenseNote: "Vendored from CTAN. Follow IEEE author guidelines for submissions.",
  },
  {
    id: "acm-acmart",
    name: "ACM acmart",
    publisher: "ACM",
    description: "Official ACM acmart + Tectonic-ready sample-sigconf (CTAN).",
    tags: ["official", "journal", "conference", "acm", "bundled"],
    downloadPage: "https://ctan.org/pkg/acmart",
    zipHint: "Bundled from CTAN acmart (cls/samples generated via DocStrip).",
    mainCandidates: ["sample-sigconf.tex"],
    licenseNote: "LPPL. Vendored from CTAN for offline project creation.",
  },
];

export function listOfficialTemplates(): OfficialTemplateSpec[] {
  return OFFICIAL_TEMPLATE_CATALOG;
}

export function getOfficialTemplate(id: string): OfficialTemplateSpec | undefined {
  return OFFICIAL_TEMPLATE_CATALOG.find((t) => t.id === id);
}
