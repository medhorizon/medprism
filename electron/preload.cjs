const { contextBridge, ipcRenderer } = require("electron");

// Sandboxed preload scripts cannot require arbitrary local modules. Keep these
// fixed channel names in sync with electron/compile/service.cjs.
const CHANNELS = Object.freeze({
  run: "medprism:compile:run",
  cancel: "medprism:compile:cancel",
  available: "medprism:compile:available",
});

contextBridge.exposeInMainWorld("medprismDesktop", {
  isDesktop: true,
  platform: process.platform,
  compile: Object.freeze({
    run: (request) => ipcRenderer.invoke(CHANNELS.run, request),
    cancel: (jobId) => ipcRenderer.invoke(CHANNELS.cancel, jobId),
    isAvailable: () => ipcRenderer.invoke(CHANNELS.available),
  }),
});
