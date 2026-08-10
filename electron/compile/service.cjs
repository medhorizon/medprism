const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MAX_CONCURRENT_JOBS = 2;

const CHANNELS = Object.freeze({
  run: "medprism:compile:run",
  cancel: "medprism:compile:cancel",
  available: "medprism:compile:available",
});

function registerCompileService(ipcMain, options = {}) {
  const jobs = new Map();
  const coreUrl = pathToFileURL(path.join(__dirname, "core.mjs")).href;
  const loadCore = () => import(coreUrl);

  ipcMain.handle(CHANNELS.run, async (_event, request) => {
    const controller = new AbortController();
    const requestedJobId =
      request && typeof request.jobId === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(request.jobId)
        ? request.jobId
        : undefined;
    const key = requestedJobId || `${Date.now()}-${Math.random()}`;
    if (jobs.has(key)) {
      return { ok: false, jobId: key, code: "DUPLICATE_JOB", log: "", error: "Compile job id is already active" };
    }
    if (jobs.size >= MAX_CONCURRENT_JOBS) {
      return { ok: false, jobId: key, code: "BUSY", log: "", error: "Compile service is busy" };
    }
    jobs.set(key, controller);
    try {
      const { compileProject } = await loadCore();
      const result = await compileProject(request, {
        signal: controller.signal,
        ...(options.executable ? { executable: options.executable } : {}),
      });
      return { ...result, clientJobId: key };
    } finally {
      jobs.delete(key);
    }
  });

  ipcMain.handle(CHANNELS.cancel, async (_event, jobId) => {
    if (typeof jobId !== "string") return { ok: false, error: "jobId is required" };
    const controller = jobs.get(jobId);
    if (!controller) return { ok: false, error: "Compile job not found" };
    controller.abort();
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.available, async () => {
    const { isCompileEngineAvailable } = await loadCore();
    return isCompileEngineAvailable(
      options.executable ? { executable: options.executable } : undefined,
    );
  });

  return () => {
    for (const controller of jobs.values()) controller.abort();
    jobs.clear();
    for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
  };
}

module.exports = { CHANNELS, registerCompileService };
