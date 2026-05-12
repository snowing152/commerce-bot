import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('api', {
  startBot: (tasksArray: any) => ipcRenderer.send('start-bot', tasksArray),
  stopBot: () => ipcRenderer.send('stop-bot'),

  onLog: (callback: (msg: string) => void) => {
    const handler = (_e: IpcRendererEvent, msg: string) => callback(msg);
    ipcRenderer.on('bot-log', handler);
    return () => ipcRenderer.removeListener('bot-log', handler);
  },

  onDone: (callback: (path: string | null) => void) => {
    const handler = (_e: IpcRendererEvent, path: string | null) => callback(path);
    ipcRenderer.on('bot-done', handler);
    return () => ipcRenderer.removeListener('bot-done', handler);
  },

  onBotResult: (callback: (data: any) => void) => {
    const handler = (_e: IpcRendererEvent, data: any) => callback(data);
    ipcRenderer.on('bot-result', handler);
    return () => ipcRenderer.removeListener('bot-result', handler);
  },

  // Session persistence
  saveSession: (data: any) => ipcRenderer.invoke('save-session', data),
  loadSession: () => ipcRenderer.invoke('load-session'),
  loadResults: () => ipcRenderer.invoke('load-results'),
  clearResults: () => ipcRenderer.invoke('clear-results'),
  exportResultsCsv: () => ipcRenderer.invoke('export-results-csv'),

  // Send logs to Telegram
  sendLogToTelegram: () => ipcRenderer.invoke('send-log-telegram'),
  openScreenshot: (path: string) => ipcRenderer.send('open-path', path),

  onUpdateProgress: (callback: (percent: number) => void) => {
    const handler = (_e: IpcRendererEvent, p: number) => callback(p);
    ipcRenderer.on('update-progress', handler);
    return () => ipcRenderer.removeListener('update-progress', handler);
  },

  // New IPC channels
  getVersion: () => ipcRenderer.invoke('get-version'),

  onUpdateStatus: (
    callback: (payload: { key: string; params?: Record<string, string | number> }) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
  },

  onUpdateError: (
    callback: (payload: {
      message: string | null;
      retryInSec: number | null;
      attempt: number | null;
    }) => void,
  ) => {
    const handler = (_e: IpcRendererEvent, payload: any) => callback(payload);
    ipcRenderer.on('update-error', handler);
    return () => ipcRenderer.removeListener('update-error', handler);
  },

  // Auth
  getBotUsername: () => ipcRenderer.invoke('get-bot-username'),

  // Subscription
  getSubscriptionStatus: () => ipcRenderer.invoke('get-subscription-status'),
  openPaymentBot: () => ipcRenderer.invoke('open-payment-bot'),

  onSubscriptionUpdated: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('subscription-updated', handler);
    return () => ipcRenderer.removeListener('subscription-updated', handler);
  },

  // Navigation
  navigateTo: (page: string) => ipcRenderer.invoke('navigate-to', page),

  // Logout
  logout: () => ipcRenderer.invoke('logout'),

  startTelegramAuth: () => ipcRenderer.invoke('start-telegram-auth'),
  checkAuthToken: (token: string) => ipcRenderer.invoke('check-auth-token', token),
  clearChromeDebugProfile: () => ipcRenderer.invoke('clear-chrome-debug-profile'),
});
