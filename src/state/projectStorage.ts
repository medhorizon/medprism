import type { StorageLike } from "./projectStore";

const PROJECT_KEYS = /^(?:medprism\.projects|medprism\.projectIndex|medprism\.project\.|medprism\.projectRecovery\.)/;

export function projectStorage(): StorageLike {
  return window.medprismDesktop?.projects ?? localStorage;
}

/** Move v2.0.0 browser-backed projects into the desktop file store once. */
export function migrateProjectsToDesktop(): void {
  const desktop = window.medprismDesktop?.projects;
  if (!desktop) return;
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key): key is string => !!key && PROJECT_KEYS.test(key));
  for (const key of keys) {
    const value = localStorage.getItem(key);
    if (value === null || desktop.getItem(key) !== null) continue;
    desktop.setItem(key, value);
    if (desktop.getItem(key) === value) localStorage.removeItem(key);
  }
}
