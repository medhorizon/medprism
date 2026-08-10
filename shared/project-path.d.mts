export class UnsafeProjectPathError extends Error {
  readonly value: string;
  readonly reason: string;
  constructor(value: string, reason: string);
}
export function assertSafeProjectRelativePath(value: string): string;
export function isSafeProjectRelativePath(value: string): boolean;
