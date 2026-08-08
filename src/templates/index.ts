import { getOfficialTemplate, listOfficialTemplates } from "./catalog";
import { loadBundledOfficialTemplate } from "./loadBundled";
import type { ExtractedOfficialTemplate, OfficialTemplateSpec } from "./types";

export type { ExtractedOfficialTemplate, OfficialTemplateSpec } from "./types";
export { detectMainFile } from "./detectMain";
export {
  getOfficialTemplate,
  listOfficialTemplates,
  OFFICIAL_TEMPLATE_CATALOG,
} from "./catalog";
export { loadBundledOfficialTemplate, listBundledTemplateIds } from "./loadBundled";

/** @deprecated Use listOfficialTemplates */
export function listTemplates(): OfficialTemplateSpec[] {
  return listOfficialTemplates();
}

/** @deprecated Use getOfficialTemplate */
export function getTemplate(id: string): OfficialTemplateSpec | undefined {
  return getOfficialTemplate(id);
}

export function filesToFileList(files: Record<string, string>, order?: string[]) {
  const keys = order?.length ? order.filter((k) => k in files) : Object.keys(files);
  const rest = Object.keys(files).filter((k) => !keys.includes(k));
  return [...keys, ...rest].map((path) => {
    const lower = path.toLowerCase();
    const kind = lower.endsWith(".bib")
      ? ("bib" as const)
      : lower.endsWith(".cls") || lower.endsWith(".sty") || lower.endsWith(".bst")
        ? ("cls" as const)
        : lower.endsWith(".pdf") || lower.endsWith(".png") || lower.endsWith(".jpg")
          ? ("asset" as const)
          : ("tex" as const);
    return {
      id: path,
      name: path,
      kind,
    };
  });
}

export async function createFilesFromBundledTemplate(
  templateId: string,
): Promise<{ spec: OfficialTemplateSpec; extracted: ExtractedOfficialTemplate }> {
  const spec = getOfficialTemplate(templateId);
  if (!spec) throw new Error(`Unknown official template id: ${templateId}`);
  const extracted = await loadBundledOfficialTemplate(templateId);
  return { spec, extracted };
}
