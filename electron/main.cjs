const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { registerCompileService } = require("./compile/service.cjs");

/** @type {BrowserWindow | null} */
let mainWindow = null;
let disposeCompileService = null;

function resolveTectonicExecutable() {
  const configured = process.env.MEDPRISM_TECTONIC_PATH;
  if (configured) return configured;
  const executable = process.platform === "win32" ? "tectonic.exe" : "tectonic";
  const bundled = path.join(
    process.resourcesPath,
    "tectonic",
    `${process.platform}-${process.arch}`,
    executable,
  );
  return fs.existsSync(bundled) ? bundled : executable;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "MedPrism",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        void shell.openExternal(parsed.toString());
      }
    } catch {
      // Invalid and non-web URLs are denied.
    }
    return { action: "deny" };
  });

  if (app.isPackaged) {
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  } else {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173");
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  disposeCompileService = registerCompileService(ipcMain, {
    executable: resolveTectonicExecutable(),
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  disposeCompileService?.();
  disposeCompileService = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
