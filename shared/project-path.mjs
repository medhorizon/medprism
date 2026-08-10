export class UnsafeProjectPathError extends Error {
  constructor(value, reason) {
    super(`Unsafe project-relative path ${JSON.stringify(value)}: ${reason}`);
    this.name = "UnsafeProjectPathError";
    this.value = value;
    this.reason = reason;
  }
}

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const WINDOWS_DRIVE_RE = /^[a-z]:($|\/)/i;
const WINDOWS_RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WINDOWS_INVALID_CHARS_RE = /[<>:"|?*]/;

export function assertSafeProjectRelativePath(value) {
  if (typeof value !== "string") {
    throw new UnsafeProjectPathError(String(value), "path must be a string");
  }
  if (!value || !value.trim()) {
    throw new UnsafeProjectPathError(value, "path is empty");
  }
  if (value.includes("\0")) {
    throw new UnsafeProjectPathError(value, "NUL byte is forbidden");
  }
  const normalized = value.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.startsWith("//")) {
    throw new UnsafeProjectPathError(value, "absolute paths are forbidden");
  }
  if (WINDOWS_DRIVE_RE.test(normalized)) {
    throw new UnsafeProjectPathError(value, "Windows drive paths are forbidden");
  }
  if (URL_SCHEME_RE.test(normalized)) {
    throw new UnsafeProjectPathError(value, "URL-like paths are forbidden");
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part === "")) {
    throw new UnsafeProjectPathError(value, "empty path segments are forbidden");
  }
  if (parts.some((part) => part === "." || part === "..")) {
    throw new UnsafeProjectPathError(value, "dot traversal segments are forbidden");
  }
  if (parts.some((part) => /[\u0000-\u001f\u007f]/.test(part))) {
    throw new UnsafeProjectPathError(value, "control characters are forbidden");
  }
  if (parts.some((part) => WINDOWS_INVALID_CHARS_RE.test(part))) {
    throw new UnsafeProjectPathError(value, "Windows-incompatible filename characters are forbidden");
  }
  if (parts.some((part) => part.endsWith(".") || part.endsWith(" "))) {
    throw new UnsafeProjectPathError(value, "path segments may not end with a dot or space");
  }
  if (parts.some((part) => WINDOWS_RESERVED_RE.test(part))) {
    throw new UnsafeProjectPathError(value, "Windows reserved device names are forbidden");
  }
  return parts.join("/");
}

export function isSafeProjectRelativePath(value) {
  try {
    assertSafeProjectRelativePath(value);
    return true;
  } catch {
    return false;
  }
}
