import { DEMO_PROJECT_ID, PROJECT_NAME, SOURCE } from "../data/sample";
import {
  getOfficialTemplate,
  loadBundledOfficialTemplate,
  type ExtractedOfficialTemplate,
} from "../templates";

export type Project = {
  id: string;
  title: string;
  updatedAt: string;
  templateId: string;
  templateName?: string;
  files: Record<string, string>;
  mainFile?: string;
  fileOrder?: string[];
};

const STORAGE_KEY = "medprism.projects";

export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Project[];
  } catch {
    return [];
  }
}

export function saveProjects(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function upsertProject(project: Project) {
  const all = loadProjects();
  const idx = all.findIndex((p) => p.id === project.id);
  if (idx >= 0) all[idx] = project;
  else all.unshift(project);
  saveProjects(all);
  return project;
}

export function getProject(id: string): Project | undefined {
  return loadProjects().find((p) => p.id === id);
}

export function deleteProject(id: string) {
  saveProjects(loadProjects().filter((p) => p.id !== id));
}

export function renameProject(id: string, title: string): Project | null {
  const all = loadProjects();
  const idx = all.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const nextTitle = title.trim();
  if (!nextTitle) return all[idx];
  const updated: Project = {
    ...all[idx],
    title: nextTitle,
    updatedAt: new Date().toISOString(),
  };
  all[idx] = updated;
  saveProjects(all);
  return updated;
}

export function createProjectFromExtracted(args: {
  title: string;
  templateId: string;
  extracted: ExtractedOfficialTemplate;
}): Project | null {
  const spec = getOfficialTemplate(args.templateId);
  if (!spec) return null;

  const project: Project = {
    id: crypto.randomUUID(),
    title: args.title.trim() || spec.name,
    updatedAt: new Date().toISOString(),
    templateId: spec.id,
    templateName: spec.name,
    files: { ...args.extracted.files },
    mainFile: args.extracted.mainFile,
    fileOrder: args.extracted.fileOrder,
  };
  upsertProject(project);
  return project;
}

/** Create a project by copying the vendored official folder. */
export async function createProjectFromBundledTemplate(args: {
  title: string;
  templateId: string;
}): Promise<Project | null> {
  const extracted = await loadBundledOfficialTemplate(args.templateId);
  return createProjectFromExtracted({
    title: args.title,
    templateId: args.templateId,
    extracted,
  });
}

/** Ensure the built-in sepsis demo exists for first-run UX (not an official template). */
export function ensureDemoProject(): Project {
  const existing = getProject(DEMO_PROJECT_ID);
  if (existing) return existing;

  const demo: Project = {
    id: DEMO_PROJECT_ID,
    title: PROJECT_NAME,
    updatedAt: new Date().toISOString(),
    templateId: "demo-sample",
    templateName: "Demo sample (not official)",
    files: { ...SOURCE },
    mainFile: "main.tex",
    fileOrder: Object.keys(SOURCE),
  };
  upsertProject(demo);
  return demo;
}

/** Migrate stale demo keys once (old short ids → path ids) */
export function migrateLocalProjects() {
  const all = loadProjects();
  let changed = false;
  const next = all.map((p) => {
    if (p.id !== DEMO_PROJECT_ID) return p;
    if (p.files["main.tex"]) return p;
    changed = true;
    return {
      ...p,
      files: { ...SOURCE },
      mainFile: "main.tex",
      fileOrder: Object.keys(SOURCE),
      updatedAt: new Date().toISOString(),
    };
  });
  if (changed) saveProjects(next);
}
