"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("api", {
  startBot: (tasksArray) => electron.ipcRenderer.send("start-bot", tasksArray),
  onLog: (callback) => {
    const handler = (_e, msg) => callback(msg);
    electron.ipcRenderer.on("bot-log", handler);
    return () => electron.ipcRenderer.removeListener("bot-log", handler);
  },
  onDone: (callback) => {
    const handler = (_e, path) => callback(path);
    electron.ipcRenderer.on("bot-done", handler);
    return () => electron.ipcRenderer.removeListener("bot-done", handler);
  },
  onBotResult: (callback) => {
    const handler = (_e, data) => callback(data);
    electron.ipcRenderer.on("bot-result", handler);
    return () => electron.ipcRenderer.removeListener("bot-result", handler);
  },
  // Session persistence
  saveSession: (data) => electron.ipcRenderer.invoke("save-session", data),
  loadSession: () => electron.ipcRenderer.invoke("load-session"),
  // Send logs to Telegram
  sendLogToTelegram: () => electron.ipcRenderer.invoke("send-log-telegram"),
  openScreenshot: (path) => electron.ipcRenderer.send("open-path", path),
  onUpdateProgress: (callback) => {
    const handler = (_e, p) => callback(p);
    electron.ipcRenderer.on("update-progress", handler);
    return () => electron.ipcRenderer.removeListener("update-progress", handler);
  },
  // New IPC channels
  getVersion: () => electron.ipcRenderer.invoke("get-version"),
  onUpdateStatus: (callback) => {
    const handler = (_e, text) => callback(text);
    electron.ipcRenderer.on("update-status", handler);
    return () => electron.ipcRenderer.removeListener("update-status", handler);
  },
  onUpdateError: (callback) => {
    const handler = (_e, payload) => callback(payload);
    electron.ipcRenderer.on("update-error", handler);
    return () => electron.ipcRenderer.removeListener("update-error", handler);
  },
  // Auth
  loginWithTelegram: (tgUser) => electron.ipcRenderer.invoke("login-with-telegram", tgUser),
  getBotUsername: () => electron.ipcRenderer.invoke("get-bot-username"),
  // Subscription
  getSubscriptionStatus: () => electron.ipcRenderer.invoke("get-subscription-status"),
  openPaymentBot: () => electron.ipcRenderer.invoke("open-payment-bot"),
  onSubscriptionUpdated: (cb) => {
    const handler = () => cb();
    electron.ipcRenderer.on("subscription-updated", handler);
    return () => electron.ipcRenderer.removeListener("subscription-updated", handler);
  },
  // Navigation
  navigateTo: (page) => electron.ipcRenderer.invoke("navigate-to", page),
  // Logout
  logout: () => electron.ipcRenderer.invoke("logout"),
  startTelegramAuth: () => electron.ipcRenderer.invoke("start-telegram-auth"),
  checkAuthToken: (token) => electron.ipcRenderer.invoke("check-auth-token", token),
  clearChromeDebugProfile: () => electron.ipcRenderer.invoke("clear-chrome-debug-profile")
});
