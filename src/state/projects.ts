import { DEMO_PROJECT_ID, PROJECT_NAME, SOURCE } from "../data/sample";
import {
  getOfficialTemplate,
  loadBundledOfficialTemplate,
  type ExtractedOfficialTemplate,
} from "../templates";
import { clearProjectArtifacts } from "./projectArtifacts";
import { clearSessionChat } from "./projectChatSession";
import {
  PROJECT_SCHEMA_VERSION,
  ProjectStore,
  type Project,
  type StoreError,
  type StoreResult,
} from "./projectStore";

export type { Project } from "./projectStore";

let lastStoreError: StoreError | null = null;

function store(): ProjectStore {
  return new ProjectStore(localStorage);
}

function remember<T>(result: StoreResult<T>): StoreResult<T> {
  lastStoreError = result.ok ? null : result.error;
  return result;
}

export function getLastProjectStoreError(): StoreError | null {
  return lastStoreError;
}

export function loadProjectsResult(): StoreResult<Project[]> {
  const instance = store();
  const migration = instance.migrateLegacy();
  if (!migration.ok) return remember(migration);
  return remember(instance.loadProjects());
}

export function loadProjects(): Project[] {
  const result = loadProjectsResult();
  return result.ok ? result.value : [];
}

export function saveProjects(projects: Project[]): StoreResult<Project[]> {
  const instance = store();
  const saved: Project[] = [];
  for (const project of projects) {
    const result = instance.saveProject(project, { expectedRevision: project.revision });
    if (!result.ok) return remember(result);
    saved.push(result.value);
  }
  return remember({ ok: true, value: saved });
}

export function upsertProjectResult(
  project: Project,
  expectedRevision = project.revision,
): StoreResult<Project> {
  return remember(store().saveProject(project, { expectedRevision }));
}

/** Compatibility wrapper. Callers that need user-visible errors should use upsertProjectResult. */
export function upsertProject(project: Project): Project {
  const result = upsertProjectResult(project);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export function getProjectResult(id: string): StoreResult<Project> {
  return remember(store().loadProject(id));
}

export function getProject(id: string): Project | undefined {
  const result = getProjectResult(id);
  if (result.ok) return result.value;
  if (result.error.code === "PARSE_ERROR" || result.error.code === "INVALID_PROJECT") {
    const recovered = remember(store().restoreRecovery(id));
    return recovered.ok ? recovered.value : undefined;
  }
  if (result.error.code === "NOT_FOUND") return undefined;
  return undefined;
}

export function restoreProjectFromRecovery(id: string): StoreResult<Project> {
  return remember(store().restoreRecovery(id));
}

export function deleteProject(id: string): StoreResult<void> {
  const result = remember(store().deleteProject(id));
  if (result.ok) {
    clearProjectArtifacts(id);
    clearSessionChat(id);
  }
  return result;
}

export function renameProject(id: string, title: string): Project | null {
  const current = getProject(id);
  if (!current) return null;
  const nextTitle = title.trim();
  if (!nextTitle) return current;
  const result = upsertProjectResult(
    { ...current, title: nextTitle, updatedAt: new Date().toISOString() },
    current.revision,
  );
  return result.ok ? result.value : null;
}

function newProject(input: Omit<Project, "schemaVersion" | "revision">): Project {
  return { ...input, schemaVersion: PROJECT_SCHEMA_VERSION, revision: 0 };
}

export function createProjectFromExtracted(args: {
  title: string;
  templateId: string;
  extracted: ExtractedOfficialTemplate;
}): Project | null {
  const spec = getOfficialTemplate(args.templateId);
  if (!spec) return null;
  const project = newProject({
    id: crypto.randomUUID(),
    title: args.title.trim() || spec.name,
    updatedAt: new Date().toISOString(),
    templateId: spec.id,
    templateName: spec.name,
    files: { ...args.extracted.files },
    ...(args.extracted.mainFile ? { mainFile: args.extracted.mainFile } : {}),
    ...(args.extracted.fileOrder ? { fileOrder: args.extracted.fileOrder } : {}),
  });
  const saved = remember(store().saveProject(project, { expectedRevision: 0 }));
  return saved.ok ? saved.value : null;
}

export async function createProjectFromBundledTemplate(args: {
  title: string;
  templateId: string;
}): Promise<Project | null> {
  const extracted = await loadBundledOfficialTemplate(args.templateId);
  return createProjectFromExtracted({ ...args, extracted });
}

export function ensureDemoProject(): Project {
  const existing = getProject(DEMO_PROJECT_ID);
  if (existing) return existing;
  const demo = newProject({
    id: DEMO_PROJECT_ID,
    title: PROJECT_NAME,
    updatedAt: new Date().toISOString(),
    templateId: "demo-sample",
    templateName: "Demo sample (not official)",
    files: { ...SOURCE },
    mainFile: "main.tex",
    fileOrder: Object.keys(SOURCE),
  });
  const saved = remember(store().saveProject(demo, { expectedRevision: 0 }));
  if (!saved.ok) throw new Error(saved.error.message);
  return saved.value;
}

export function migrateLocalProjects(): StoreResult<number> {
  const instance = store();
  const migrated = instance.migrateLegacy();
  if (!migrated.ok) return remember(migrated);

  const demo = instance.loadProject(DEMO_PROJECT_ID);
  if (demo.ok && !demo.value.files["main.tex"]) {
    const repaired = instance.saveProject(
      {
        ...demo.value,
        files: { ...SOURCE },
        mainFile: "main.tex",
        fileOrder: Object.keys(SOURCE),
        updatedAt: new Date().toISOString(),
      },
      { expectedRevision: demo.value.revision },
    );
    if (!repaired.ok) return remember(repaired);
  }
  return remember(migrated);
}
