/** Catalog entry for a vendored official publisher template folder. */
export type OfficialTemplateSpec = {
  id: string;
  name: string;
  publisher: string;
  description: string;
  tags: string[];
  /** Publisher / CTAN page (attribution / updates) */
  downloadPage: string;
  /** Short hint shown in the picker */
  zipHint: string;
  /** Preferred main .tex basenames or paths inside the bundled folder */
  mainCandidates: string[];
  licenseNote: string;
};

/** Files loaded from a bundled official template folder */
export type ExtractedOfficialTemplate = {
  files: Record<string, string>;
  fileOrder: string[];
  mainFile: string;
  skippedBinaryCount: number;
  rootPrefix: string | null;
};
