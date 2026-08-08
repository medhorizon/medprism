---
name: literature-cite
description: Add or correct citations and BibTeX entries. Use when the user asks to cite guidelines, Sepsis-3, or related work.
---

# Literature cite

## Hard rules

1. **Never invent** bibliographic metadata (PMID, DOI, year, authors, title).
2. Always prefer results from the `paper_search` tool (Europe PMC).
3. BibTeX in suggestions must be copied from tool-provided `bibtex` fields (deterministic). You may only choose which hit to use and where to `\cite{key}`.

## Required workflow

1. Ensure `paper_search` has been run for the user's topic.
2. If zero hits: tell the user nothing was found; do not fabricate.
3. If hits exist: pick the best matching entry; use its `bibtex` as the `.bib` suggestion body.
4. Propose a second suggestion (if needed) for the `.tex` file inserting `\cite{citeKey}` near the relevant claim.
5. Output using the suggestion fence protocol (`path` + `title` + body).

## Example intent

User: "补充 Sepsis-3 引用" → search → insert cite + BibTeX from hits only.
