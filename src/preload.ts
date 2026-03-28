import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  startBot: (tasksArray: any) => ipcRenderer.send("start-bot", tasksArray),
  onLog: (callback: (msg: string) => void) =>
    ipcRenderer.on("bot-log", (_event, msg) => callback(msg)),
  onDone: (callback: (path: string | null) => void) =>
    ipcRenderer.on("bot-done", (_event, path) => callback(path)),
  openScreenshot: (path: string) => ipcRenderer.send("open-path", path),
  onUpdateProgress: (callback: (percent: number) => void) =>
    ipcRenderer.on("update-progress", (_event, p) => callback(p)),

  // Новые каналы связи
  getVersion: () => ipcRenderer.invoke("get-version"),
  onUpdateStatus: (callback: (text: string) => void) =>
    ipcRenderer.on("update-status", (_event, text) => callback(text)),
  onUpdateError: (
    callback: (payload: {
      message: string | null;
      retryInSec: number | null;
      attempt: number | null;
    }) => void,
  ) => ipcRenderer.on("update-error", (_event, payload) => callback(payload)),
});
