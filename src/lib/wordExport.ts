import { exportProjectWord, type CompileRequest, type WordExportResult } from "./compileClient";

export async function downloadProjectWord(
  request: CompileRequest,
  fileName: string,
): Promise<WordExportResult> {
  const result = await exportProjectWord(request);
  if (!result.ok || !result.docxBase64) return result;

  const binary = atob(result.docxBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([copy], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.toLowerCase().endsWith(".docx") ? fileName : `${fileName}.docx`;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return result;
}
