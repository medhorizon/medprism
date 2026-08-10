import { assertSafeProjectRelativePath } from "../lib/projectPath";

export const PROJECT_SCHEMA_VERSION = 1 as const;
export const PROJECT_SOFT_LIMIT_BYTES = 4 * 1024 * 1024;
const LEGACY_KEY = "medprism.projects";
const INDEX_KEY = "medprism.projectIndex";
const PROJECT_PREFIX = "medprism.project.";
const RECOVERY_PREFIX = "medprism.projectRecovery.";

export type Project = {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  revision: number;
  id: string;
  title: string;
  updatedAt: string;
  templateId: string;
  templateName?: string;
  files: Record<string, string>;
  mainFile?: string;
  fileOrder?: string[];
};

export type ProjectIndexEntry = Pick<Project, "id" | "title" | "updatedAt" | "templateId"> & {
  templateName?: string;
  revision: number;
  approximateBytes: number;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type StoreErrorCode =
  | "NOT_FOUND"
  | "PARSE_ERROR"
  | "INVALID_PROJECT"
  | "REVISION_CONFLICT"
  | "QUOTA_EXCEEDED"
  | "STORAGE_ERROR"
  | "MIGRATION_FAILED";

export type StoreError = { code: StoreErrorCode; message: string; cause?: unknown };
export type StoreResult<T> = { ok: true; value: T } | { ok: false; error: StoreError };

function approximateBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function estimateProjectBytes(project: Project): number {
  return approximateBytes(JSON.stringify(project));
}

function classifyStorageError(error: unknown): StoreError {
  const DomException = globalThis.DOMException;
  const name = typeof DomException === "function" && error instanceof DomException ? error.name : "";
  if (name === "QuotaExceededError" || /quota/i.test(String(error))) {
    return { code: "QUOTA_EXCEEDED", message: "Browser storage quota was exceeded", cause: error };
  }
  return {
    code: "STORAGE_ERROR",
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  };
}

function invalidProject(message: string, cause?: unknown): StoreResult<never> {
  return {
    ok: false,
    error: {
      code: "INVALID_PROJECT",
      message,
      ...(cause === undefined ? {} : { cause }),
    },
  };
}

function normalizeProject(value: unknown): Project | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    !raw.id.trim() ||
    typeof raw.title !== "string" ||
    typeof raw.updatedAt !== "string" ||
    typeof raw.templateId !== "string" ||
    !raw.files ||
    typeof raw.files !== "object" ||
    Array.isArray(raw.files)
  ) {
    return null;
  }

  const files: Record<string, string> = {};
  try {
    for (const [untrustedPath, content] of Object.entries(raw.files as Record<string, unknown>)) {
      if (typeof content !== "string") return null;
      const safePath = assertSafeProjectRelativePath(untrustedPath);
      if (safePath in files) return null;
      files[safePath] = content;
    }
  } catch {
    return null;
  }
  if (Object.keys(files).length === 0) return null;

  let mainFile: string | undefined;
  if (typeof raw.mainFile === "string" && raw.mainFile.trim()) {
    try {
      const normalized = assertSafeProjectRelativePath(raw.mainFile);
      if (!(normalized in files)) return null;
      mainFile = normalized;
    } catch {
      return null;
    }
  }

  let fileOrder: string[] | undefined;
  if (Array.isArray(raw.fileOrder)) {
    const seen = new Set<string>();
    fileOrder = [];
    try {
      for (const entry of raw.fileOrder) {
        if (typeof entry !== "string") continue;
        const normalized = assertSafeProjectRelativePath(entry);
        if (!(normalized in files) || seen.has(normalized)) continue;
        seen.add(normalized);
        fileOrder.push(normalized);
      }
    } catch {
      return null;
    }
    for (const path of Object.keys(files)) {
      if (!seen.has(path)) fileOrder.push(path);
    }
  }

  const templateName = typeof raw.templateName === "string" ? raw.templateName : undefined;
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    revision: Number.isInteger(raw.revision) && Number(raw.revision) >= 0 ? Number(raw.revision) : 0,
    id: raw.id,
    title: raw.title,
    updatedAt: raw.updatedAt,
    templateId: raw.templateId,
    ...(templateName ? { templateName } : {}),
    files,
    ...(mainFile ? { mainFile } : {}),
    ...(fileOrder ? { fileOrder } : {}),
  };
}

function indexEntry(project: Project, serialized: string): ProjectIndexEntry {
  return {
    id: project.id,
    title: project.title,
    updatedAt: project.updatedAt,
    templateId: project.templateId,
    ...(project.templateName ? { templateName: project.templateName } : {}),
    revision: project.revision,
    approximateBytes: approximateBytes(serialized),
  };
}

export class ProjectStore {
  private readonly storage: StorageLike;

  constructor(storage: StorageLike) {
    this.storage = storage;
  }

  private projectKey(id: string) {
    return `${PROJECT_PREFIX}${id}`;
  }

  private recoveryKey(id: string) {
    return `${RECOVERY_PREFIX}${id}`;
  }

  loadIndex(): StoreResult<ProjectIndexEntry[]> {
    try {
      const raw = this.storage.getItem(INDEX_KEY);
      if (!raw) return { ok: true, value: [] };
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return { ok: false, error: { code: "PARSE_ERROR", message: "Project index is invalid" } };
      }
      const entries = parsed.filter(
        (item): item is ProjectIndexEntry =>
          !!item &&
          typeof item === "object" &&
          typeof (item as ProjectIndexEntry).id === "string" &&
          typeof (item as ProjectIndexEntry).title === "string" &&
          typeof (item as ProjectIndexEntry).updatedAt === "string" &&
          typeof (item as ProjectIndexEntry).templateId === "string" &&
          Number.isInteger((item as ProjectIndexEntry).revision) &&
          typeof (item as ProjectIndexEntry).approximateBytes === "number",
      );
      if (entries.length !== parsed.length) {
        return { ok: false, error: { code: "PARSE_ERROR", message: "Project index contains invalid entries" } };
      }
      if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
        return { ok: false, error: { code: "PARSE_ERROR", message: "Project index contains duplicate ids" } };
      }
      return { ok: true, value: entries };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error instanceof SyntaxError ? "PARSE_ERROR" : "STORAGE_ERROR",
          message: "Could not read project index",
          cause: error,
        },
      };
    }
  }

  loadProject(id: string): StoreResult<Project> {
    try {
      const raw = this.storage.getItem(this.projectKey(id));
      if (!raw) return { ok: false, error: { code: "NOT_FOUND", message: `Project not found: ${id}` } };
      const project = normalizeProject(JSON.parse(raw));
      if (!project) return invalidProject(`Invalid project: ${id}`);
      if (project.id !== id) return invalidProject(`Project id mismatch for ${id}`);
      return { ok: true, value: project };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error instanceof SyntaxError ? "PARSE_ERROR" : "STORAGE_ERROR",
          message: `Could not read project: ${id}`,
          cause: error,
        },
      };
    }
  }

  loadRecovery(id: string): StoreResult<Project> {
    try {
      const raw = this.storage.getItem(this.recoveryKey(id));
      if (!raw) return { ok: false, error: { code: "NOT_FOUND", message: `Recovery not found: ${id}` } };
      const project = normalizeProject(JSON.parse(raw));
      if (!project) return invalidProject(`Invalid recovery: ${id}`);
      if (project.id !== id) return invalidProject(`Recovery id mismatch for ${id}`);
      return { ok: true, value: project };
    } catch (error) {
      return {
        ok: false,
        error: {
          code: error instanceof SyntaxError ? "PARSE_ERROR" : "STORAGE_ERROR",
          message: `Could not read recovery: ${id}`,
          cause: error,
        },
      };
    }
  }

  loadProjects(): StoreResult<Project[]> {
    const index = this.loadIndex();
    if (!index.ok) return index;
    const projects: Project[] = [];
    for (const entry of index.value) {
      let result = this.loadProject(entry.id);
      if (!result.ok && (result.error.code === "PARSE_ERROR" || result.error.code === "INVALID_PROJECT")) {
        result = this.restoreRecovery(entry.id);
      }
      if (!result.ok) return result;
      projects.push(result.value);
    }
    return { ok: true, value: projects };
  }

  /** Restore the last verified snapshot without trusting a corrupted primary value. */
  restoreRecovery(id: string): StoreResult<Project> {
    const recovery = this.loadRecovery(id);
    if (!recovery.ok) return recovery;
    const index = this.loadIndex();
    if (!index.ok) return index;

    const previousIndexEntry = index.value.find((entry) => entry.id === id);
    const next: Project = {
      ...recovery.value,
      revision: Math.max(recovery.value.revision, previousIndexEntry?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    const serialized = JSON.stringify(next);
    const entries = index.value.filter((entry) => entry.id !== id);
    entries.unshift(indexEntry(next, serialized));

    const projectKey = this.projectKey(id);
    let oldProjectRaw: string | null = null;
    let oldIndexRaw: string | null = null;
    try {
      oldProjectRaw = this.storage.getItem(projectKey);
      oldIndexRaw = this.storage.getItem(INDEX_KEY);
      this.storage.setItem(projectKey, serialized);
      this.storage.setItem(INDEX_KEY, JSON.stringify(entries));
      const verified = this.loadProject(id);
      if (!verified.ok || verified.value.revision !== next.revision) {
        throw new Error(`Could not verify recovered project ${id}`);
      }
      return verified;
    } catch (error) {
      try {
        if (oldProjectRaw === null) this.storage.removeItem(projectKey);
        else this.storage.setItem(projectKey, oldProjectRaw);
        if (oldIndexRaw === null) this.storage.removeItem(INDEX_KEY);
        else this.storage.setItem(INDEX_KEY, oldIndexRaw);
      } catch {
        // Best-effort rollback.
      }
      return { ok: false, error: classifyStorageError(error) };
    }
  }

  saveProject(
    input: Omit<Project, "schemaVersion" | "revision"> & Partial<Pick<Project, "schemaVersion" | "revision">>,
    options: { expectedRevision?: number } = {},
  ): StoreResult<Project> {
    const current = this.loadProject(input.id);
    if (!current.ok && current.error.code !== "NOT_FOUND") return current;
    const currentProject = current.ok ? current.value : undefined;

    if (options.expectedRevision !== undefined) {
      const actual = currentProject?.revision ?? 0;
      if (actual !== options.expectedRevision) {
        return {
          ok: false,
          error: {
            code: "REVISION_CONFLICT",
            message: `Project ${input.id} changed from revision ${options.expectedRevision} to ${actual}`,
          },
        };
      }
    }

    const normalized = normalizeProject({
      ...input,
      schemaVersion: PROJECT_SCHEMA_VERSION,
      revision: currentProject?.revision ?? input.revision ?? 0,
    });
    if (!normalized) return invalidProject(`Refusing to save invalid project ${input.id}`);

    const next: Project = {
      ...normalized,
      revision: (currentProject?.revision ?? normalized.revision) + 1,
      updatedAt: normalized.updatedAt || new Date().toISOString(),
    };
    const serialized = JSON.stringify(next);
    const index = this.loadIndex();
    if (!index.ok) return index;
    const entries = index.value.filter((entry) => entry.id !== input.id);
    entries.unshift(indexEntry(next, serialized));
    const serializedIndex = JSON.stringify(entries);

    const projectKey = this.projectKey(input.id);
    const recoveryKey = this.recoveryKey(input.id);
    let oldProjectRaw: string | null;
    let oldRecoveryRaw: string | null;
    let oldIndexRaw: string | null;
    try {
      oldProjectRaw = this.storage.getItem(projectKey);
      oldRecoveryRaw = this.storage.getItem(recoveryKey);
      oldIndexRaw = this.storage.getItem(INDEX_KEY);
    } catch (error) {
      return { ok: false, error: classifyStorageError(error) };
    }

    const restore = () => {
      try {
        if (oldProjectRaw === null) this.storage.removeItem(projectKey);
        else this.storage.setItem(projectKey, oldProjectRaw);
        if (oldRecoveryRaw === null) this.storage.removeItem(recoveryKey);
        else this.storage.setItem(recoveryKey, oldRecoveryRaw);
        if (oldIndexRaw === null) this.storage.removeItem(INDEX_KEY);
        else this.storage.setItem(INDEX_KEY, oldIndexRaw);
      } catch {
        // Best-effort rollback; the returned error still tells the UI to export in-memory data.
      }
    };

    try {
      this.storage.setItem(recoveryKey, JSON.stringify(currentProject ?? next));
      this.storage.setItem(projectKey, serialized);
      this.storage.setItem(INDEX_KEY, serializedIndex);

      const verify = this.loadProject(input.id);
      if (!verify.ok || verify.value.revision !== next.revision) {
        restore();
        return {
          ok: false,
          error: { code: "STORAGE_ERROR", message: `Could not verify saved project ${input.id}` },
        };
      }
      return { ok: true, value: verify.value };
    } catch (error) {
      restore();
      return { ok: false, error: classifyStorageError(error) };
    }
  }

  deleteProject(id: string): StoreResult<void> {
    const index = this.loadIndex();
    if (!index.ok) return index;
    const projectKey = this.projectKey(id);
    const recoveryKey = this.recoveryKey(id);
    let oldProjectRaw: string | null;
    let oldRecoveryRaw: string | null;
    let oldIndexRaw: string | null;
    try {
      oldProjectRaw = this.storage.getItem(projectKey);
      oldRecoveryRaw = this.storage.getItem(recoveryKey);
      oldIndexRaw = this.storage.getItem(INDEX_KEY);
    } catch (error) {
      return { ok: false, error: classifyStorageError(error) };
    }

    const restore = () => {
      try {
        if (oldProjectRaw === null) this.storage.removeItem(projectKey);
        else this.storage.setItem(projectKey, oldProjectRaw);
        if (oldRecoveryRaw === null) this.storage.removeItem(recoveryKey);
        else this.storage.setItem(recoveryKey, oldRecoveryRaw);
        if (oldIndexRaw === null) this.storage.removeItem(INDEX_KEY);
        else this.storage.setItem(INDEX_KEY, oldIndexRaw);
      } catch {
        // Best-effort rollback.
      }
    };

    try {
      this.storage.removeItem(projectKey);
      this.storage.removeItem(recoveryKey);
      this.storage.setItem(
        INDEX_KEY,
        JSON.stringify(index.value.filter((entry) => entry.id !== id)),
      );
      const verify = this.loadIndex();
      if (!verify.ok || verify.value.some((entry) => entry.id === id)) {
        restore();
        return {
          ok: false,
          error: { code: "STORAGE_ERROR", message: `Could not verify deleted project ${id}` },
        };
      }
      return { ok: true, value: undefined };
    } catch (error) {
      restore();
      return { ok: false, error: classifyStorageError(error) };
    }
  }

  migrateLegacy(): StoreResult<number> {
    let raw: string | null;
    try {
      raw = this.storage.getItem(LEGACY_KEY);
    } catch (error) {
      return { ok: false, error: { ...classifyStorageError(error), code: "MIGRATION_FAILED" } };
    }
    if (!raw) return { ok: true, value: 0 };

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return { ok: false, error: { code: "MIGRATION_FAILED", message: "Legacy project list is invalid" } };
      }
      const projects = parsed.map(normalizeProject);
      if (projects.some((project) => !project)) {
        return { ok: false, error: { code: "MIGRATION_FAILED", message: "Legacy project is invalid" } };
      }
      const legacyIds = (projects as Project[]).map((project) => project.id);
      if (new Set(legacyIds).size !== legacyIds.length) {
        return { ok: false, error: { code: "MIGRATION_FAILED", message: "Legacy project list contains duplicate ids" } };
      }

      let migrated = 0;
      for (const project of projects as Project[]) {
        const existing = this.loadProject(project.id);
        if (existing.ok) continue;
        if (existing.error.code !== "NOT_FOUND") {
          return { ok: false, error: { ...existing.error, code: "MIGRATION_FAILED" } };
        }
        const saved = this.saveProject({ ...project, revision: 0 }, { expectedRevision: 0 });
        if (!saved.ok) return { ok: false, error: { ...saved.error, code: "MIGRATION_FAILED" } };
        migrated += 1;
      }

      const verification = this.loadProjects();
      if (!verification.ok) {
        return { ok: false, error: { ...verification.error, code: "MIGRATION_FAILED" } };
      }
      this.storage.removeItem(LEGACY_KEY);
      return { ok: true, value: migrated };
    } catch (error) {
      return {
        ok: false,
        error: { code: "MIGRATION_FAILED", message: "Legacy migration failed", cause: error },
      };
    }
  }
}
