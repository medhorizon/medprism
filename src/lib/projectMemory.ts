/** Soft cap for optional per-project memory notes injected into LLM context. */
export const MAX_PROJECT_MEMORY_CHARS = 4_000;

/** Normalize and truncate optional project memory notes. */
export function normalizeProjectMemory(notes: string): string {
  return notes.replace(/\r\n?/g, "\n").trim().slice(0, MAX_PROJECT_MEMORY_CHARS);
}
