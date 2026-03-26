import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { AutomationEngine } from './engine';

function createWindow() {
    const win = new BrowserWindow({
        width: 550, // Сделали окно чуть шире
        height: 650,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    win.loadFile(path.join(__dirname, '../src/index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('start-bot', async (event, tasksArray) => {
    try {
        const configPath = path.join(__dirname, '../config/config.json');
        
        const rawConfig = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(rawConfig);
        
        config.tasks = tasksArray;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        const engine = new AutomationEngine();
        
        // Перехватываем логи и отправляем их прямо в UI
        engine.onLog = (msg) => event.reply('bot-log', msg);
        
        // Запускаем бота и ждем путь к сохраненному файлу
        const screenshotPath = await engine.run();
        
        // Сообщаем UI о завершении
        event.reply('bot-done', screenshotPath);

    } catch (error: any) {
        event.reply('bot-log', `[КРИТИЧЕСКАЯ ОШИБКА] ${error.message}`);
        event.reply('bot-done', null);
    }
});

// Открывает проводник Windows и подсвечивает сделанный файл
ipcMain.on('open-path', (event, p) => {
    if (p) shell.showItemInFolder(p);
});