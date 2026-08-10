import { assertSafeProjectRelativePath } from "../projectPath";
import { sha256Hex } from "./hash";

/** Stable revision for an immutable in-memory project snapshot. */
export async function projectRevision(files: Record<string, string>): Promise<string> {
  const rows = Object.entries(files)
    .map(([rawPath, content]) => [assertSafeProjectRelativePath(rawPath), content] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  let canonical = "medprism-project-revision-v1\n";
  for (const [path, content] of rows) {
    canonical += `${path.length}:${path}\n${content.length}:${content}\n`;
  }
  return sha256Hex(canonical);
}
