import type { IncomingMessage, ServerResponse } from "node:http";

export function resolveUpstreamChatUrl(baseUrl: string): string;
export function describeFetchError(error: unknown, upstreamUrl?: string): string;
export function llmDevProxyMiddleware(req: IncomingMessage, res: ServerResponse): Promise<void>;
