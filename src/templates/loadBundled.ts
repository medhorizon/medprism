import { getOfficialTemplate } from "./catalog";
import { detectMainFile } from "./detectMain";
import type { ExtractedOfficialTemplate } from "./types";

const TEXT_FILE =
  /\.(tex|bib|cls|bst|sty|txt|md|cfg|clo|def|fd|ins|dtx|bbx|cbx|lbx|dbx|html|xml|json|csv|bbl|eps)$/i;
const TEXT_BASENAME = /^(readme|license|makefile|manifest\.txt|changelog\.txt|source\.txt)$/i;

/**
 * All files under templates/official/** (lazy raw imports).
 * Path keys look like: ../../templates/official/<id>/...
 */
const bundledModules = import.meta.glob("../../templates/official/**/*", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

function normalizeKey(modulePath: string) {
  return modulePath.replace(/\\/g, "/");
}

function isTextPath(relPath: string) {
  const base = relPath.split("/").pop() ?? relPath;
  return TEXT_FILE.test(relPath) || TEXT_BASENAME.test(base);
}

/** Skip package-build / test / doc noise when copying into a project. */
function shouldIncludeInProject(relPath: string) {
  const lower = relPath.toLowerCase();
  if (lower.includes("/doc/") || lower.startsWith("doc/")) return false;
  // ACM DocStrip sources live under samples/; authoring files are at package root
  if (lower.includes("/samples/") || lower.startsWith("samples/")) return false;
  if (lower.includes("testflow")) return false;
  if (/(^|\/)tmp(\.|-)/i.test(relPath)) return false;
  if (/\.(dtx|ins)$/i.test(relPath)) return false;
  if (/changelog/i.test(relPath)) return false;
  return true;
}

/** List template ids that have a vendored folder present in the bundle. */
export function listBundledTemplateIds(): string[] {
  const ids = new Set<string>();
  for (const key of Object.keys(bundledModules)) {
    const m = normalizeKey(key).match(/templates\/official\/([^/]+)\//);
    if (m) ids.add(m[1]);
  }
  return [...ids].sort();
}

export async function loadBundledOfficialTemplate(
  templateId: string,
): Promise<ExtractedOfficialTemplate> {
  const spec = getOfficialTemplate(templateId);
  if (!spec) {
    throw new Error(`Unknown template: ${templateId}`);
  }

  const needle = `/templates/official/${templateId}/`;
  const matches = Object.entries(bundledModules).filter(([key]) =>
    normalizeKey(key).includes(needle),
  );

  if (!matches.length) {
    throw new Error(
      `Bundled official folder missing for "${templateId}". Expected templates/official/${templateId}/`,
    );
  }

  const files: Record<string, string> = {};
  let skippedBinaryCount = 0;

  await Promise.all(
    matches.map(async ([modulePath, loader]) => {
      const norm = normalizeKey(modulePath);
      const idx = norm.indexOf(needle);
      const rel = norm.slice(idx + needle.length);
      if (!rel || rel.endsWith("/")) return;
      if (!isTextPath(rel) || !shouldIncludeInProject(rel)) {
        skippedBinaryCount += 1;
        return;
      }
      files[rel] = await loader();
    }),
  );

  if (!Object.keys(files).length) {
    throw new Error(`No text files found in bundled template "${templateId}".`);
  }

  const mainFile =
    detectMainFile(files, spec.mainCandidates) ??
    Object.keys(files).find((p) => p.toLowerCase().endsWith(".tex"));

  if (!mainFile) {
    throw new Error(`No .tex entry file found in bundled template "${templateId}".`);
  }

  const fileOrder = [
    mainFile,
    ...Object.keys(files)
      .filter((p) => p !== mainFile)
      .sort((a, b) => a.localeCompare(b)),
  ];

  return {
    files,
    fileOrder,
    mainFile,
    skippedBinaryCount,
    rootPrefix: null,
  };
}
