/** In-project encoding for binary assets stored in `Project.files` string map. */
export const BINARY_FILE_PREFIX = "medprism-binary/v1;base64,";

export function isBinaryFileContent(content: string): boolean {
  return content.startsWith(BINARY_FILE_PREFIX);
}

export function encodeBinaryBase64(base64: string): string {
  const trimmed = base64.replace(/\s+/g, "");
  if (!trimmed) throw new Error("Empty binary payload");
  return `${BINARY_FILE_PREFIX}${trimmed}`;
}

export function encodeBinaryBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return encodeBinaryBase64(btoa(binary));
}

export function decodeBinaryFile(content: string): Uint8Array | null {
  if (!isBinaryFileContent(content)) return null;
  const base64 = content.slice(BINARY_FILE_PREFIX.length);
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

export function compiledPdfPath(mainFile: string): string {
  return mainFile.replace(/\.tex$/i, ".pdf");
}

const COMPILE_ATTACHMENT_EXT = /\.(png|jpe?g|gif|webp|pdf)$/i;

function graphicsReferences(files: Record<string, string>): Set<string> {
  const refs = new Set<string>();
  for (const [path, content] of Object.entries(files)) {
    if (!path.toLowerCase().endsWith(".tex") || isBinaryFileContent(content)) continue;
    for (const match of content.matchAll(/\\includegraphics(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/gi)) {
      const raw = match[1]!.trim().replace(/\\/g, "/").replace(/^\.\//, "");
      if (!raw) continue;
      refs.add(raw.toLowerCase());
      refs.add(raw.replace(/\.[^.]+$/, "").toLowerCase());
      const base = raw.split("/").pop();
      if (base) {
        refs.add(base.toLowerCase());
        refs.add(base.replace(/\.[^.]+$/, "").toLowerCase());
      }
    }
  }
  return refs;
}

function isUnreferencedAttachment(
  path: string,
  content: string,
  refs: Set<string>,
): boolean {
  if (!isBinaryFileContent(content) || !COMPILE_ATTACHMENT_EXT.test(path)) return false;
  const slash = path.replace(/\\/g, "/").toLowerCase();
  const base = slash.split("/").pop() ?? slash;
  const stem = base.replace(/\.[^.]+$/, "");
  return !(
    refs.has(slash) ||
    refs.has(slash.replace(/\.[^.]+$/, "")) ||
    refs.has(base) ||
    refs.has(stem)
  );
}

/** Drop generated PDF and unused image attachments; keep only graphics the .tex cites. */
export function filesForCompile(
  files: Record<string, string>,
  mainFile?: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  const generatedPdf = mainFile ? compiledPdfPath(mainFile).toLowerCase() : null;
  const refs = graphicsReferences(files);
  for (const [path, content] of Object.entries(files)) {
    const lowerPath = path.toLowerCase();
    if (generatedPdf ? lowerPath === generatedPdf : isBinaryFileContent(content) && lowerPath.endsWith(".pdf")) {
      continue;
    }
    if (isUnreferencedAttachment(path, content, refs)) continue;
    out[path] = content;
  }
  return out;
}

/** True when the only file-map differences are binary image/PDF attachments. */
export function onlyBinaryAttachmentChanges(
  before: Record<string, string>,
  after: Record<string, string>,
): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const path of keys) {
    if (before[path] === after[path]) continue;
    const contents = [before[path], after[path]].filter((value): value is string => value !== undefined);
    if (
      contents.some((content) => !isBinaryFileContent(content)) ||
      !COMPILE_ATTACHMENT_EXT.test(path)
    ) {
      return false;
    }
  }
  return true;
}

export function fileBytesForExport(content: string): Uint8Array {
  const decoded = decodeBinaryFile(content);
  if (decoded) return decoded;
  return new TextEncoder().encode(content);
}

/** Insert/replace the compiled PDF next to the main .tex file. */
export function withCompiledPdfFiles(
  files: Record<string, string>,
  mainFile: string,
  pdfBase64: string,
  fileOrder?: string[],
): { files: Record<string, string>; fileOrder?: string[] } {
  const pdfPath = compiledPdfPath(mainFile);
  const nextFiles = {
    ...files,
    [pdfPath]: encodeBinaryBase64(pdfBase64),
  };
  if (!fileOrder) return { files: nextFiles };
  if (fileOrder.includes(pdfPath)) return { files: nextFiles, fileOrder };
  return { files: nextFiles, fileOrder: [...fileOrder, pdfPath] };
}
