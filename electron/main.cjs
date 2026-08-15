const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { registerCompileService } = require("./compile/service.cjs");

/** @type {BrowserWindow | null} */
let mainWindow = null;
let disposeCompileService = null;

const PROJECT_STORAGE_CHANNELS = Object.freeze({
  get: "medprism:projects:get",
  set: "medprism:projects:set",
  remove: "medprism:projects:remove",
  openFolder: "medprism:projects:open-folder",
});

function projectStorageRoot() {
  return path.join(app.getPath("userData"), "projects");
}

function storageFile(key) {
  const digest = crypto.createHash("sha256").update(key).digest("hex");
  return path.join(projectStorageRoot(), `${digest}.json`);
}

function projectFolder(id) {
  const digest = crypto.createHash("sha256").update(id).digest("hex").slice(0, 20);
  return path.join(projectStorageRoot(), `project-${digest}`);
}

function assertStorageKey(key) {
  if (typeof key !== "string" || !/^medprism\.(?:project(?:Recovery)?\.|projectIndex$|projects$)/.test(key)) {
    throw new Error("Unsupported project storage key");
  }
}

function assertProjectId(id) {
  if (typeof id !== "string" || !id || id.length > 200 || /[\0\r\n]/.test(id)) {
    throw new Error("Invalid project id");
  }
}

function materializeProject(value) {
  let project;
  try {
    project = JSON.parse(value);
  } catch {
    return;
  }
  if (!project || typeof project !== "object" || typeof project.id !== "string" || !project.files) return;
  assertProjectId(project.id);
  const root = projectFolder(project.id);
  const filesRoot = path.join(root, "files");
  fs.mkdirSync(filesRoot, { recursive: true });
  const expected = new Set();
  for (const [relativePath, content] of Object.entries(project.files)) {
    if (typeof content !== "string") continue;
    const normalized = relativePath.replace(/\\/g, "/");
    if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw new Error("Unsafe project file path");
    }
    const target = path.resolve(filesRoot, ...normalized.split("/"));
    if (target !== filesRoot && !target.startsWith(`${filesRoot}${path.sep}`)) {
      throw new Error("Unsafe project file path");
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const binaryPrefix = "medprism-binary/v1;base64,";
    if (content.startsWith(binaryPrefix)) {
      fs.writeFileSync(target, Buffer.from(content.slice(binaryPrefix.length), "base64"));
    } else {
      fs.writeFileSync(target, content, "utf8");
    }
    expected.add(target.toLowerCase());
  }
  function removeStaleFiles(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) removeStaleFiles(fullPath);
      else if (entry.isFile() && !expected.has(fullPath.toLowerCase())) fs.rmSync(fullPath, { force: true });
    }
  }
  removeStaleFiles(filesRoot);
  fs.writeFileSync(
    path.join(root, "project.json"),
    JSON.stringify({ ...project, files: Object.keys(project.files) }, null, 2),
    "utf8",
  );
}

function registerProjectStorage() {
  fs.mkdirSync(projectStorageRoot(), { recursive: true });
  ipcMain.on(PROJECT_STORAGE_CHANNELS.get, (event, key) => {
    try {
      assertStorageKey(key);
      const file = storageFile(key);
      event.returnValue = { ok: true, value: fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null };
    } catch (error) {
      event.returnValue = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.on(PROJECT_STORAGE_CHANNELS.set, (event, key, value) => {
    try {
      assertStorageKey(key);
      if (typeof value !== "string") throw new Error("Project storage value must be a string");
      fs.writeFileSync(storageFile(key), value, "utf8");
      if (key.startsWith("medprism.project.")) materializeProject(value);
      event.returnValue = { ok: true };
    } catch (error) {
      event.returnValue = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.on(PROJECT_STORAGE_CHANNELS.remove, (event, key) => {
    try {
      assertStorageKey(key);
      fs.rmSync(storageFile(key), { force: true });
      if (key.startsWith("medprism.project.")) {
        const id = key.slice("medprism.project.".length);
        assertProjectId(id);
        fs.rmSync(projectFolder(id), { recursive: true, force: true });
      }
      event.returnValue = { ok: true };
    } catch (error) {
      event.returnValue = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(PROJECT_STORAGE_CHANNELS.openFolder, async (_event, id) => {
    assertProjectId(id);
    const folder = projectFolder(id);
    fs.mkdirSync(folder, { recursive: true });
    const error = await shell.openPath(folder);
    return error ? { ok: false, error } : { ok: true };
  });
}

function resolveTectonicExecutable() {
  const configured = process.env.MEDPRISM_TECTONIC_PATH;
  if (configured && fs.existsSync(configured)) return configured;
  const executable = process.platform === "win32" ? "tectonic.exe" : "tectonic";
  const platformDir = `${process.platform}-${process.arch}`;
  const candidates = [
    // Packaged app: extraResources → resources/tectonic/<platform>/
    path.join(process.resourcesPath, "tectonic", platformDir, executable),
    // Local/dev Electron: repo resources/tectonic/<platform>/
    path.join(__dirname, "..", "resources", "tectonic", platformDir, executable),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return executable;
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

async function startAutoUpdate() {
  if (!app.isPackaged) return;
  // Portable builds have no installer to replace.
  if (process.env.PORTABLE_EXECUTABLE_DIR) return;
  const { autoUpdater } = require("electron-updater");
  const { pickReleaseMirror } = require("./releaseMirrors.cjs");
  autoUpdater.on("error", (error) => {
    console.error("auto-update failed:", error);
  });
  const url = await pickReleaseMirror();
  if (!url) {
    console.error("auto-update skipped: no release mirror reachable");
    return;
  }
  autoUpdater.setFeedURL({ provider: "generic", url });
  void autoUpdater.checkForUpdatesAndNotify();
}

app.whenReady().then(() => {
  registerProjectStorage();
  disposeCompileService = registerCompileService(ipcMain, {
    executable: resolveTectonicExecutable(),
  });
  createWindow();
  startAutoUpdate();
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
