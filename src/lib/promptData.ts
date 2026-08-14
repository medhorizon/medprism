/** Serialize untrusted data without allowing it to terminate textual prompt tags. */
export function stringifyPromptData(value: unknown): string {
  return (JSON.stringify(value, null, 2) ?? "null")
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function taggedPromptData(
  tag:
    | "workspace_context"
    | "trusted_tool_results"
    | "review_context"
    | "user_request"
    | "runtime_rejection",
  attributes: string,
  value: unknown,
): string {
  const suffix = attributes.trim() ? ` ${attributes.trim()}` : "";
  return `<${tag}${suffix}>\n${stringifyPromptData(value)}\n</${tag}>`;
}
