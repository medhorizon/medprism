import type { Project, ProjectStore, StoreResult } from "./projectStore";

export type ProjectSaveQueueOptions = {
  onSaved?: (saved: Project) => void;
  onError?: (result: Extract<StoreResult<Project>, { ok: false }>) => void;
  delayMs?: number;
};

/** Serial debounced persistence that captures the latest object at enqueue time. */
export class ProjectSaveQueue {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private chain: Promise<StoreResult<Project> | undefined> = Promise.resolve(undefined);
  private readonly lastQueueRevision = new Map<string, number>();
  private readonly lastQueueProject = new Map<string, string>();
  private readonly store: ProjectStore;
  private readonly getLatest: () => Project | null;
  private readonly onSaved: (saved: Project) => void;
  private readonly onError: (result: Extract<StoreResult<Project>, { ok: false }>) => void;
  private readonly delayMs: number;

  constructor(
    store: ProjectStore,
    getLatest: () => Project | null,
    options: ProjectSaveQueueOptions = {},
  ) {
    this.store = store;
    this.getLatest = getLatest;
    this.onSaved = options.onSaved ?? (() => undefined);
    this.onError = options.onError ?? (() => undefined);
    this.delayMs = options.delayMs ?? 750;
  }

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.delayMs);
  }

  private saveCaptured(captured: Project): StoreResult<Project> {
    let result = this.store.saveProject(captured, {
      expectedRevision: captured.revision,
    });

    // A previous operation from this same serialized queue may have advanced
    // the stored revision before a newer captured buffer is persisted. Rebase
    // only when the current revision is known to be queue-owned; never use this
    // path to overwrite a revision created by another tab/process.
    if (!result.ok && result.error.code === "REVISION_CONFLICT") {
      const current = this.store.loadProject(captured.id);
      const queueRevision = this.lastQueueRevision.get(captured.id);
      const queueProject = this.lastQueueProject.get(captured.id);
      if (
        current.ok &&
        queueRevision === current.value.revision &&
        queueProject === JSON.stringify(current.value)
      ) {
        result = this.store.saveProject(
          { ...captured, revision: current.value.revision },
          { expectedRevision: current.value.revision },
        );
      }
    }

    if (result.ok) {
      this.lastQueueRevision.set(result.value.id, result.value.revision);
      this.lastQueueProject.set(result.value.id, JSON.stringify(result.value));
      this.onSaved(result.value);
    } else {
      this.onError(result);
    }
    return result;
  }

  flush(snapshot?: Project): Promise<StoreResult<Project> | undefined> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const captured = snapshot ?? this.getLatest();
    this.chain = this.chain.then(() => {
      if (!captured) return undefined;
      return this.saveCaptured(captured);
    });
    return this.chain;
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
