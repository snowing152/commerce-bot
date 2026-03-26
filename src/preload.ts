import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    startBot: (tasksArray: any) => ipcRenderer.send('start-bot', tasksArray),
    onLog: (callback: (msg: string) => void) => ipcRenderer.on('bot-log', (_event, msg) => callback(msg)),
    onDone: (callback: (path: string | null) => void) => ipcRenderer.on('bot-done', (_event, path) => callback(path)),
    openScreenshot: (path: string) => ipcRenderer.send('open-path', path)
});