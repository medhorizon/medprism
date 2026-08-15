const RELEASE_MIRRORS = [
  "https://ghproxy.net/https://github.com/medhorizon/medprism/releases/latest/download",
  "https://gh.ddlc.top/https://github.com/medhorizon/medprism/releases/latest/download",
  "https://ghfast.top/https://github.com/medhorizon/medprism/releases/latest/download",
  "https://github.com/medhorizon/medprism/releases/latest/download",
];

async function pickReleaseMirror({ fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  const probes = RELEASE_MIRRORS.map(async (base) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const response = await fetchImpl(`${base}/latest.yml`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(String(response.status));
      const text = await response.text();
      if (!/^version:\s/m.test(text)) throw new Error("invalid feed");
      return { base, ms: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  });
  const winner = (await Promise.allSettled(probes))
    .filter((item) => item.status === "fulfilled")
    .map((item) => item.value)
    .sort((a, b) => a.ms - b.ms)[0];
  return winner ? winner.base : null;
}

module.exports = { RELEASE_MIRRORS, pickReleaseMirror };
