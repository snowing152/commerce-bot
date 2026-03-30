import { contextBridge, ipcRenderer } from "electron";
import { marked } from "marked";

contextBridge.exposeInMainWorld("api", {
  startBot: (tasksArray: any) => ipcRenderer.send("start-bot", tasksArray),
  onLog: (callback: (msg: string) => void) =>
    ipcRenderer.on("bot-log", (_event, msg) => callback(msg)),
  onDone: (callback: (path: string | null) => void) =>
    ipcRenderer.on("bot-done", (_event, path) => callback(path)),
  openScreenshot: (path: string) => ipcRenderer.send("open-path", path),
  onUpdateProgress: (callback: (percent: number) => void) =>
    ipcRenderer.on("update-progress", (_event, p) => callback(p)),

  // Версия и статус обновлений
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

  /**
   * Удаляет папку chrome_debug_profile, сбрасывая сессию браузера.
   * Возвращает Promise<{ success: boolean; alreadyClean?: boolean; error?: string }>
   */
  clearProfile: () => ipcRenderer.invoke("clear-profile"),

  // Markdown to HTML for changelog rendering.
  renderMarkdown: (markdown: string) => marked.parse(markdown ?? ""),
});
