import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { AutomationEngine } from './engine';

// Получаем системную папку для хранения изменяемых данных (в Windows это AppData/Roaming/Coupang Bot)
const USER_DATA_PATH = app.getPath('userData');

// Функция для безопасного копирования базовых конфигов при первом запуске
function setupUserFiles() {
    const configDest = path.join(USER_DATA_PATH, 'config.json');
    const selectorsDest = path.join(USER_DATA_PATH, 'selectors.json');
    
    // Исходные файлы внутри защищенного архива программы
    const configSrc = path.join(__dirname, '../config/config.json');
    const selectorsSrc = path.join(__dirname, '../config/selectors.json');

    if (!fs.existsSync(configDest) && fs.existsSync(configSrc)) {
        fs.copyFileSync(configSrc, configDest);
    }
    if (!fs.existsSync(selectorsDest) && fs.existsSync(selectorsSrc)) {
        fs.copyFileSync(selectorsSrc, selectorsDest);
    }
}

function createWindow() {
    const win = new BrowserWindow({
        width: 550,
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

app.whenReady().then(() => {
    setupUserFiles(); // Подготавливаем файлы перед открытием окна
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('start-bot', async (event, tasksArray) => {
    try {
        // Теперь мы читаем и пишем в разрешенную папку AppData
        const configPath = path.join(USER_DATA_PATH, 'config.json');
        
        const rawConfig = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(rawConfig);
        
        config.tasks = tasksArray;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

        // Передаем путь к AppData внутрь движка, чтобы он знал, куда сохранять скриншоты
        const engine = new AutomationEngine(USER_DATA_PATH);
        
        engine.onLog = (msg) => event.reply('bot-log', msg);
        
        const screenshotPath = await engine.run();
        event.reply('bot-done', screenshotPath);

    } catch (error: any) {
        event.reply('bot-log', `[КРИТИЧЕСКАЯ ОШИБКА] ${error.message}`);
        event.reply('bot-done', null);
    }
});

ipcMain.on('open-path', (event, p) => {
    if (p) shell.showItemInFolder(p);
});