import { app, BrowserWindow, ipcMain, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import { autoUpdater } from "electron-updater";
import { AutomationEngine } from "./engine";

// Получаем системную папку для хранения изменяемых данных (в Windows это AppData/Roaming/Coupang Bot)
const USER_DATA_PATH = app.getPath("userData");
const WEBHOOK_URL =
  "https://script.google.com/macros/s/AKfycbynrDykyYNXvJDsxtPiGX4NI4nzFC5V9f6ELclKIr436nXikOTCcd2snXYIL95Xrhk2/exec";

// Обработчик получения версии приложения
ipcMain.handle("get-version", () => {
  return app.getVersion();
});

// Обработчик отправки логов на прокси-сервер
ipcMain.handle("send-telegram-logs", async (event, logs) => {
  try {
    const message = `🚨 Логи Coupang Bot v${app.getVersion()}\n\n${logs}`;

    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      // МЕНЯЕМ ЗАГОЛОВОК: text/plain проходит через защиты Google без проблем
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ text: message.substring(0, 4000) }),
      redirect: "follow", // Обязательно следуем за переадресацией Google
    });

    // Читаем ответ как текст, а не как строгий JSON
    const resultText = await response.text();
    return resultText.includes("success");
  } catch (error) {
    console.error("Ошибка отправки логов на Webhook:", error);
    return false;
  }
});

// Функция для безопасного копирования базовых конфигов при первом запуске
function setupUserFiles() {
  const configDest = path.join(USER_DATA_PATH, "config.json");
  const selectorsDest = path.join(USER_DATA_PATH, "selectors.json");

  // Исходные файлы внутри защищенного архива программы
  const configSrc = path.join(__dirname, "../config/config.json");
  const selectorsSrc = path.join(__dirname, "../config/selectors.json");

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
    icon: path.join(__dirname, "../assets/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadFile(path.join(__dirname, "../src/index.html"));

  setupAutoUpdater(win);
}

// Функция для управления процессом обновления
function setupAutoUpdater(win: BrowserWindow) {
  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on("update-available", () => {
    // Отправляем текст статуса на главный экран
    win.webContents.send(
      "update-status",
      "Найдено обновление. Загрузка в фоне...",
    );
    win.webContents.send(
      "bot-log",
      "[СИСТЕМА] Найдено обновление. Начинаю загрузку...",
    );
  });

  autoUpdater.on("download-progress", (progressObj) => {
    const percent = Math.round(progressObj.percent);
    win.webContents.send("update-progress", percent);
    // Показываем проценты на главном экране
    win.webContents.send("update-status", `Скачивание обновления: ${percent}%`);
  });

  autoUpdater.on("update-downloaded", () => {
    win.webContents.send("update-status", "Обновление готово. Перезапуск...");
    win.webContents.send(
      "bot-log",
      "[СИСТЕМА] Обновление загружено. Перезапуск через 3 секунды...",
    );
    setTimeout(() => {
      autoUpdater.quitAndInstall();
    }, 3000);
  });
}

app.whenReady().then(() => {
  setupUserFiles(); // Подготавливаем файлы перед открытием окна
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.on("start-bot", async (event, tasksArray) => {
  try {
    // Теперь мы читаем и пишем в разрешенную папку AppData
    const configPath = path.join(USER_DATA_PATH, "config.json");

    const rawConfig = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(rawConfig);

    config.tasks = tasksArray;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Передаем путь к AppData внутрь движка, чтобы он знал, куда сохранять скриншоты
    const engine = new AutomationEngine(USER_DATA_PATH);

    engine.onLog = (msg) => event.reply("bot-log", msg);

    const screenshotPath = await engine.run();
    event.reply("bot-done", screenshotPath);
  } catch (error: any) {
    event.reply("bot-log", `[КРИТИЧЕСКАЯ ОШИБКА] ${error.message}`);
    event.reply("bot-done", null);
  }
});

ipcMain.on("open-path", (event, p) => {
  if (p) shell.showItemInFolder(p);
});
