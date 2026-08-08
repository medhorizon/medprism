// Intentionally minimal: renderer stays a plain web app.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("medprismDesktop", {
  isDesktop: true,
  platform: process.platform,
});
