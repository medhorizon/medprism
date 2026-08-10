import { describe, expect, it } from "vitest";
import { projectFilesToZip } from "../lib/exportZip";
import { ProjectSaveQueue } from "./projectSaveQueue";
import {
  PROJECT_SOFT_LIMIT_BYTES,
  ProjectStore,
  estimateProjectBytes,
  type Project,
  type StorageLike,
} from "./projectStore";

class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
  removeItem(key: string) { this.map.delete(key); }
}

function project(id = "p"): Project {
  return {
    schemaVersion: 1,
    revision: 0,
    id,
    title: "Paper",
    updatedAt: new Date(0).toISOString(),
    templateId: "blank",
    files: { "main.tex": "A" },
  };
}

describe("project storage", () => {
  it("migrates legacy data only after verifying per-project storage", () => {
    const storage = new MemoryStorage();
    const legacy = { ...project(), schemaVersion: undefined, revision: undefined };
    storage.setItem("medprism.projects", JSON.stringify([legacy]));
    const store = new ProjectStore(storage);
    const migrated = store.migrateLegacy();
    expect(migrated.ok).toBe(true);
    expect(storage.getItem("medprism.projects")).toBeNull();
    expect(store.loadProject("p").ok).toBe(true);
  });

  it("uses revision compare-and-swap and writes the latest queued object", async () => {
    const storage = new MemoryStorage();
    const store = new ProjectStore(storage);
    const first = store.saveProject(project(), { expectedRevision: 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    let latest: Project = { ...first.value, files: { "main.tex": "newest" } };
    const queue = new ProjectSaveQueue(store, () => latest, { delayMs: 1 });
    const saved = await queue.flush();
    expect(saved?.ok).toBe(true);
    const loaded = store.loadProject("p");
    expect(loaded.ok && loaded.value.files["main.tex"]).toBe("newest");

    latest = { ...first.value, title: "stale" };
    const stale = store.saveProject(latest, { expectedRevision: first.value.revision });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("REVISION_CONFLICT");
  });



  it("serializes back-to-back snapshots without losing the newer buffer", async () => {
    const storage = new MemoryStorage();
    const store = new ProjectStore(storage);
    const first = store.saveProject(project(), { expectedRevision: 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const queue = new ProjectSaveQueue(store, () => null, { delayMs: 1 });
    const older: Project = { ...first.value, files: { "main.tex": "older" } };
    const newer: Project = { ...first.value, files: { "main.tex": "newer" } };
    const [olderResult, newerResult] = await Promise.all([
      queue.flush(older),
      queue.flush(newer),
    ]);
    expect(olderResult?.ok).toBe(true);
    expect(newerResult?.ok).toBe(true);
    const loaded = store.loadProject("p");
    expect(loaded.ok && loaded.value.files["main.tex"]).toBe("newer");
  });

  it("does not rebase over a same-revision write owned by another writer", async () => {
    const storage = new MemoryStorage();
    const store = new ProjectStore(storage);
    const first = store.saveProject(project(), { expectedRevision: 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    let injected = false;
    const queue = new ProjectSaveQueue(store, () => null, {
      delayMs: 1,
      onSaved(saved) {
        if (injected) return;
        injected = true;
        storage.setItem(
          "medprism.project.p",
          JSON.stringify({ ...saved, files: { "main.tex": "external writer" } }),
        );
      },
    });
    const older: Project = { ...first.value, files: { "main.tex": "queue older" } };
    const newer: Project = { ...first.value, files: { "main.tex": "queue newer" } };
    const [olderResult, newerResult] = await Promise.all([
      queue.flush(older),
      queue.flush(newer),
    ]);
    expect(olderResult?.ok).toBe(true);
    expect(newerResult?.ok).toBe(false);
    if (newerResult && !newerResult.ok) {
      expect(newerResult.error.code).toBe("REVISION_CONFLICT");
    }
    expect(store.loadProject("p")).toMatchObject({
      ok: true,
      value: { files: { "main.tex": "external writer" } },
    });
  });

  it("creates a recovery snapshot for the first verified save", () => {
    const storage = new MemoryStorage();
    const store = new ProjectStore(storage);
    const first = store.saveProject(project(), { expectedRevision: 0 });
    expect(first.ok).toBe(true);
    storage.setItem("medprism.project.p", "{broken-json");
    const restored = store.restoreRecovery("p");
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.value.files["main.tex"]).toBe("A");
  });

  it("restores the last verified snapshot when the primary project is corrupted", () => {
    const storage = new MemoryStorage();
    const store = new ProjectStore(storage);
    const first = store.saveProject(project(), { expectedRevision: 0 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = store.saveProject(
      { ...first.value, files: { "main.tex": "B" } },
      { expectedRevision: first.value.revision },
    );
    expect(second.ok).toBe(true);
    storage.setItem("medprism.project.p", "{broken-json");
    const restored = store.restoreRecovery("p");
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.value.files["main.tex"]).toBe("A");
  });

  it("flushes the project being left instead of a newly selected project", async () => {
    const storage = new MemoryStorage();
    const store = new ProjectStore(storage);
    const firstA = store.saveProject(project("a"), { expectedRevision: 0 });
    const firstB = store.saveProject(project("b"), { expectedRevision: 0 });
    expect(firstA.ok && firstB.ok).toBe(true);
    if (!firstA.ok || !firstB.ok) return;
    let current: Project = { ...firstB.value, files: { "main.tex": "B" } };
    const leaving: Project = { ...firstA.value, files: { "main.tex": "A unsaved" } };
    const queue = new ProjectSaveQueue(store, () => current, { delayMs: 1 });
    await queue.flush(leaving);
    expect(store.loadProject("a")).toMatchObject({
      ok: true,
      value: { files: { "main.tex": "A unsaved" } },
    });
    expect(store.loadProject("b")).toMatchObject({
      ok: true,
      value: { files: { "main.tex": "A" } },
    });
    current = leaving;
  });

  it("reports approximate project size for soft-limit warnings", () => {
    const small = project();
    expect(estimateProjectBytes(small)).toBeGreaterThan(0);
    const large: Project = {
      ...small,
      files: { "main.tex": "x".repeat(PROJECT_SOFT_LIMIT_BYTES) },
    };
    expect(estimateProjectBytes(large)).toBeGreaterThanOrEqual(PROJECT_SOFT_LIMIT_BYTES);
  });

  it("creates a real ZIP and rejects unsafe export paths", () => {
    const zip = projectFilesToZip({ "main.tex": "hello", "sections/a.tex": "world" });
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x04034b50);
    expect(() => projectFilesToZip({ "../evil.tex": "x" })).toThrow();
  });
});
