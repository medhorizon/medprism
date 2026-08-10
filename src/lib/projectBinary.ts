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

/** Drop compiled/binary payloads before sending a TeX tree to Tectonic. */
export function filesForCompile(
  files: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (path.toLowerCase().endsWith(".pdf")) continue;
    if (isBinaryFileContent(content)) continue;
    out[path] = content;
  }
  return out;
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
