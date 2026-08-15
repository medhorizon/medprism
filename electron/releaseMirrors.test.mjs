import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { RELEASE_MIRRORS, pickReleaseMirror } = createRequire(import.meta.url)("./releaseMirrors.cjs");

function feed(status, body, delayMs = 0) {
  return async () => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    };
  };
}

describe("pickReleaseMirror", () => {
  it("picks the fastest mirror that returns a real latest.yml", async () => {
    const bodies = new Map([
      [RELEASE_MIRRORS[0], { status: 200, body: "version: 2.0.6\n", delay: 40 }],
      [RELEASE_MIRRORS[1], { status: 200, body: "<html>no</html>", delay: 5 }],
      [RELEASE_MIRRORS[2], { status: 200, body: "version: 2.0.6\n", delay: 10 }],
      [RELEASE_MIRRORS[3], { status: 502, body: "", delay: 5 }],
    ]);
    const chosen = await pickReleaseMirror({
      timeoutMs: 200,
      fetchImpl: async (url) => {
        const base = url.replace(/\/latest\.yml$/, "");
        const spec = bodies.get(base);
        return feed(spec.status, spec.body, spec.delay)();
      },
    });
    expect(chosen).toBe(RELEASE_MIRRORS[2]);
  });

  it("returns null when no mirror is usable", async () => {
    const chosen = await pickReleaseMirror({
      timeoutMs: 50,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    expect(chosen).toBeNull();
  });
});
