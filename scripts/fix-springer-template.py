"""Make Springer Nature sn-jnl template compile under Tectonic/XeTeX."""
from __future__ import annotations

import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TDIR = ROOT / "templates" / "official" / "springer-nature-sn-jnl"
SRC = TDIR / "sn-article.tex"
OFFICIAL = TDIR / "sn-article.official-sample.tex"


def patch_official_sample(text: str) -> str:
    text = text.replace(
        r"\verb+\begin{verbatim}+",
        r"\texttt{\string\begin\{verbatim\}}",
    )
    text = text.replace(
        r"\verb+\end{verbatim}+",
        r"\texttt{\string\end\{verbatim\}}",
    )
    # Keep [pdflatex,...]: sn-jnl loads breakurl when @pdflatex is false,
    # and breakurl's \headerps@out crashes under Tectonic/XeTeX.
    # Heavy mathescape listings often break under XeTeX; keep a simple equation.
    replacement = (
        "% [MedPrism] Sample lstlisting omitted for Tectonic/XeTeX compatibility.\n"
        r"\begin{equation}"
        "\n"
        r"|\psi\rangle = \sum_i c_i |\phi_i\rangle"
        "\n"
        r"\end{equation}"
    )
    text, n = re.subn(
        r"\\begin\{lstlisting\}.*?\\end\{lstlisting\}",
        lambda _m: replacement,
        text,
        count=1,
        flags=re.S,
    )
    print(f"lstlisting replacements: {n}")
    return text


STARTER = r"""%% MedPrism starter for Springer Nature sn-jnl
%% Based on the official Springer Nature LaTeX template (sn-jnl).
%% Official full sample (with tables/figures demos) is kept as:
%%   sn-article.official-sample.tex
%%
%% Choose one documentclass line for your target journal style:
%% \documentclass[pdflatex,sn-basic]{sn-jnl}
%% \documentclass[pdflatex,sn-nature]{sn-jnl}
%% \documentclass[pdflatex,sn-mathphys-num]{sn-jnl}
%% \documentclass[pdflatex,sn-vancouver]{sn-jnl}
%% \documentclass[pdflatex,sn-apa]{sn-jnl}
%%
%% Keep the pdflatex option even under Tectonic/XeTeX: without it, sn-jnl
%% loads breakurl, which uses \headerps@out and fails on XeTeX.

\documentclass[pdflatex,sn-mathphys-num]{sn-jnl}

\usepackage{graphicx}%
\usepackage{multirow}%
\usepackage{amsmath,amssymb,amsfonts}%
\usepackage{amsthm}%
\usepackage{mathrsfs}%
\usepackage[title]{appendix}%
\usepackage{xcolor}%
\usepackage{textcomp}%
\usepackage{manyfoot}%
\usepackage{booktabs}%
\usepackage{algorithm}%
\usepackage{algorithmicx}%
\usepackage{algpseudocode}%
\usepackage{listings}%

\theoremstyle{thmstyleone}%
\newtheorem{theorem}{Theorem}%
\newtheorem{proposition}[theorem]{Proposition}%
\theoremstyle{thmstyletwo}%
\newtheorem{example}{Example}%
\newtheorem{remark}{Remark}%
\theoremstyle{thmstylethree}%
\newtheorem{definition}{Definition}%

\raggedbottom

\begin{document}

\title[Article Title]{Article Title}

\author*[1,2]{\fnm{First} \sur{Author}}\email{iauthor@gmail.com}
\author[2,3]{\fnm{Second} \sur{Author}}\email{iiauthor@gmail.com}
\equalcont{These authors contributed equally to this work.}
\author[1,2]{\fnm{Third} \sur{Author}}\email{iiiauthor@gmail.com}
\equalcont{These authors contributed equally to this work.}

\affil*[1]{\orgdiv{Department}, \orgname{Organization}, \orgaddress{\street{Street}, \city{City}, \postcode{100190}, \state{State}, \country{Country}}}
\affil[2]{\orgdiv{Department}, \orgname{Organization}, \orgaddress{\street{Street}, \city{City}, \postcode{10587}, \state{State}, \country{Country}}}
\affil[3]{\orgdiv{Department}, \orgname{Organization}, \orgaddress{\street{Street}, \city{City}, \postcode{610101}, \state{State}, \country{Country}}}

\abstract{The abstract serves both as a general introduction to the topic and as a brief, non-technical summary of the main results and their implications. Authors are advised to check the author instructions for the journal they are submitting to for word limits and if structural elements like subheadings, citations, or equations are permitted.}

\keywords{keyword1, Keyword2, Keyword3, Keyword4}

\maketitle

\section{Introduction}\label{sec1}

The Introduction section, of referenced text \cite{bib1}, expands on the background of the work. The introduction should not include subheadings.

\section{Results}\label{sec2}

Sample body text. Replace this section with your main findings. Use figures and tables as needed.

\section{Discussion}\label{sec3}

Interpret the results, discuss limitations, and outline implications for future work.

\section{Methods}\label{sec4}

Describe the study design, data sources, and analysis methods in sufficient detail for reproducibility.

\backmatter

\bmhead{Acknowledgements}

Acknowledgements are not compulsory. Where included they should be brief.

\section*{Declarations}

\begin{itemize}
\item Funding: Mention any funding here.
\item Conflict of interest/Competing interests: The authors declare no competing interests.
\item Ethics approval and consent to participate: Not applicable.
\item Consent for publication: Not applicable.
\item Data availability: Data availability statement.
\item Materials availability: Not applicable.
\item Code availability: Not applicable.
\item Author contribution: Describe author contributions.
\end{itemize}

\bibliography{sn-bibliography}

\end{document}
"""


def main() -> None:
    # Prefer an existing official-sample backup; else patch current sn-article.tex.
    source = OFFICIAL if OFFICIAL.exists() and OFFICIAL.stat().st_size > 10_000 else SRC
    raw = source.read_bytes()
    raw = raw.replace(bytes([0x93]), b"'").replace(bytes([0x94]), b"'")
    official = patch_official_sample(raw.decode("utf-8"))
    OFFICIAL.write_text(official, encoding="utf-8", newline="\n")
    SRC.write_text(STARTER, encoding="utf-8", newline="\n")
    print(f"wrote starter -> {SRC}")
    print(f"wrote official sample -> {OFFICIAL} (from {source.name})")


if __name__ == "__main__":
    main()
