const { contextBridge, ipcRenderer } = require("electron");

// Sandboxed preload scripts cannot require arbitrary local modules. Keep these
// fixed channel names in sync with electron/compile/service.cjs.
const CHANNELS = Object.freeze({
  run: "medprism:compile:run",
  cancel: "medprism:compile:cancel",
  available: "medprism:compile:available",
});
const PROJECT_CHANNELS = Object.freeze({
  get: "medprism:projects:get",
  set: "medprism:projects:set",
  remove: "medprism:projects:remove",
  openFolder: "medprism:projects:open-folder",
});

function projectStorageCall(channel, ...args) {
  const result = ipcRenderer.sendSync(channel, ...args);
  if (!result?.ok) throw new Error(result?.error || "Project storage failed");
  return result.value;
}

contextBridge.exposeInMainWorld("medprismDesktop", {
  isDesktop: true,
  platform: process.platform,
  projects: Object.freeze({
    getItem: (key) => projectStorageCall(PROJECT_CHANNELS.get, key),
    setItem: (key, value) => projectStorageCall(PROJECT_CHANNELS.set, key, value),
    removeItem: (key) => projectStorageCall(PROJECT_CHANNELS.remove, key),
    openFolder: (id) => ipcRenderer.invoke(PROJECT_CHANNELS.openFolder, id),
  }),
  compile: Object.freeze({
    run: (request) => ipcRenderer.invoke(CHANNELS.run, request),
    cancel: (jobId) => ipcRenderer.invoke(CHANNELS.cancel, jobId),
    isAvailable: () => ipcRenderer.invoke(CHANNELS.available),
  }),
});
