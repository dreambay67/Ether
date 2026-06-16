import { app, BrowserWindow } from "electron";
import path from "node:path";

const createMainWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: "Ether",
    backgroundColor: "#070B12",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const rendererUrl = process.env.ETHER_RENDERER_URL;

  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
};

app.whenReady().then(() => {
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
