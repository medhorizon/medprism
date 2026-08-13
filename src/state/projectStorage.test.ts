import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateProjectsToDesktop, projectStorage } from "./projectStorage";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

describe("desktop project storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses desktop storage and migrates existing project keys", () => {
    const local = memoryStorage({
      "medprism.project.p": "project",
      "medprism.projectIndex": "index",
      "medprism.api": "keep-local",
    });
    const desktop = memoryStorage();
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("window", { medprismDesktop: { projects: desktop } });

    migrateProjectsToDesktop();

    expect(projectStorage()).toBe(desktop);
    expect(desktop.getItem("medprism.project.p")).toBe("project");
    expect(desktop.getItem("medprism.projectIndex")).toBe("index");
    expect(local.getItem("medprism.project.p")).toBeNull();
    expect(local.getItem("medprism.api")).toBe("keep-local");
  });
});
