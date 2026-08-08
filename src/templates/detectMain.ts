/** Prefer catalog candidates, then files with \\documentclass, then shallow .tex paths. */
export function detectMainFile(
  files: Record<string, string>,
  candidates: string[] = [],
): string | null {
  const texPaths = Object.keys(files).filter((p) => p.toLowerCase().endsWith(".tex"));
  if (!texPaths.length) return null;

  let best: string | null = null;
  let bestScore = -Infinity;
  for (const path of texPaths) {
    const base = path.split("/").pop() ?? path;
    const lower = base.toLowerCase();
    let score = 0;
    const candIdx = candidates.findIndex(
      (c) => c.toLowerCase() === lower || path.toLowerCase().endsWith("/" + c.toLowerCase()),
    );
    if (candIdx >= 0) score += 100 - candIdx;
    const content = files[path] ?? "";
    if (/\\documentclass\b/.test(content)) score += 40;
    if (lower.includes("sample") || lower.includes("bare_") || lower.includes("template")) {
      score += 10;
    }
    if (lower === "main.tex" || lower === "manuscript.tex" || lower === "sn-article.tex") {
      score += 20;
    }
    score -= path.split("/").length;
    if (score > bestScore) {
      bestScore = score;
      best = path;
    }
  }
  return best;
}
