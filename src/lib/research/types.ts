import type { PaperHit } from "../../tools/types";

/** Why trusted literature is being collected for the current fixed workflow. */
export type ResearchPurpose =
  | "standalone"
  | "writing"
  | "polish"
  | "citation"
  | "review";

/**
 * Research is a reusable capability, not a free-running agent.
 * The router/runtime owns the query and tool policy.
 */
export type ResearchSpec = {
  /** Optional deterministic query. Runtime may fall back to the selected text. */
  query?: string;
  purpose: ResearchPurpose;
  pageSize?: number;
  /** Require at least one abstract-bearing paper before downstream drafting. */
  requireAbstract?: boolean;
};

/** Trusted output from the deterministic paper_search stage. */
export type ResearchBundle = {
  query: string;
  purpose: ResearchPurpose;
  hits: PaperHit[];
  warnings: string[];
};

/** User-visible metadata for a standalone research result. */
export type ResearchReport = {
  schemaVersion: "1";
  query: string;
  candidates: Array<{
    id: string;
    title: string;
    authors: string;
    year?: string;
    journal?: string;
    doi?: string;
    pmid?: string;
    hasAbstract: boolean;
  }>;
  warnings: string[];
};
