import { app, BrowserWindow, ipcMain, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import { autoUpdater } from "electron-updater";
import { AutomationEngine } from "./engine";

// Получаем системную папку для хранения изменяемых данных (в Windows это AppData/Roaming/Coupang Bot)
const USER_DATA_PATH = app.getPath("userData");
let autoUpdaterInitialized = false;
let updateRetryTimer: NodeJS.Timeout | null = null;
let updateRetryAttempt = 0;
const UPDATE_RETRY_BASE_MS = 15000;
const UPDATE_RETRY_MAX_MS = 300000;

// Обработчик получения версии приложения
ipcMain.handle("get-version", () => {
  return app.getVersion();
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
  } else if (fs.existsSync(configDest) && fs.existsSync(configSrc)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(configDest, "utf-8"));
      const defaultConfig = JSON.parse(fs.readFileSync(configSrc, "utf-8"));
      const defaultSettings =
        defaultConfig && typeof defaultConfig === "object"
          ? defaultConfig.settings || {}
          : {};
      const userSettings =
        userConfig && typeof userConfig === "object"
          ? userConfig.settings || {}
          : {};

      let changed = false;
      for (const [key, value] of Object.entries(defaultSettings)) {
        if (userSettings[key] === undefined) {
          userSettings[key] = value;
          changed = true;
        }
      }

      if (changed) {
        if (userConfig && typeof userConfig === "object") {
          userConfig.settings = userSettings;
          fs.writeFileSync(configDest, JSON.stringify(userConfig, null, 2));
        }
      }
    } catch (error) {
      console.warn("Не удалось обновить настройки конфигурации:", error);
    }
  }

  // Селекторы копируем ВСЕГДА (принудительно обновляем базу локаторов)
  if (fs.existsSync(selectorsSrc)) {
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

  win.webContents.once("did-finish-load", () => {
    setupAutoUpdater(win);
  });
}

// Функция для управления процессом обновления
function setupAutoUpdater(win: BrowserWindow) {
  if (autoUpdaterInitialized) return;
  autoUpdaterInitialized = true;

  if (!app.isPackaged) {
    win.webContents.send(
      "update-status",
      "Автообновление доступно только в собранной версии.",
    );
    return;
  }

  const sendStatus = (text: string) => {
    if (!win.isDestroyed()) win.webContents.send("update-status", text);
  };

  const sendProgress = (percent: number) => {
    if (!win.isDestroyed()) win.webContents.send("update-progress", percent);
  };

  const sendLog = (msg: string) => {
    if (!win.isDestroyed()) win.webContents.send("bot-log", msg);
  };

  const sendUpdateError = (
    message: string | null,
    retryInSec: number | null,
    attempt: number | null,
  ) => {
    if (!win.isDestroyed())
      win.webContents.send("update-error", {
        message,
        retryInSec,
        attempt,
      });
  };

  const clearUpdateError = () => {
    sendUpdateError(null, null, null);
  };

  const scheduleRetry = (message: string) => {
    updateRetryAttempt += 1;
    const delay = Math.min(
      UPDATE_RETRY_MAX_MS,
      UPDATE_RETRY_BASE_MS * Math.pow(2, updateRetryAttempt - 1),
    );
    const retryInSec = Math.ceil(delay / 1000);

    if (updateRetryTimer) clearTimeout(updateRetryTimer);

    sendUpdateError(message, retryInSec, updateRetryAttempt);
    sendStatus(`Ошибка обновления. Повтор через ${retryInSec} сек.`);

    updateRetryTimer = setTimeout(() => {
      if (!win.isDestroyed()) {
        sendStatus("Повторяю проверку обновлений...");
      }
      autoUpdater.checkForUpdatesAndNotify().catch((error) => {
        const nextMessage =
          error?.message || String(error || "Неизвестная ошибка");
        scheduleRetry(nextMessage);
      });
    }, delay);
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    clearUpdateError();
    sendStatus("Проверяю обновления...");
  });

  autoUpdater.on("update-available", () => {
    updateRetryAttempt = 0;
    clearUpdateError();
    // Отправляем текст статуса на главный экран
    sendStatus("Найдено обновление. Загрузка в фоне...");
    sendLog("[СИСТЕМА] Найдено обновление. Начинаю загрузку...");
  });

  autoUpdater.on("update-not-available", () => {
    updateRetryAttempt = 0;
    clearUpdateError();
    sendStatus("Установлена последняя версия");
  });

  autoUpdater.on("download-progress", (progressObj) => {
    const percent = Math.max(0, Math.min(100, Math.round(progressObj.percent)));
    sendProgress(percent);
    // Показываем проценты на главном экране
    sendStatus(`Скачивание обновления: ${percent}%`);
  });

  autoUpdater.on("update-downloaded", () => {
    updateRetryAttempt = 0;
    clearUpdateError();
    sendStatus("Обновление готово. Перезапуск...");
    sendLog("[СИСТЕМА] Обновление загружено. Перезапуск через 3 секунды...");
    setTimeout(() => {
      autoUpdater.quitAndInstall();
    }, 3000);
  });

  autoUpdater.on("error", (error) => {
    const message = error?.message || String(error || "Неизвестная ошибка");
    sendLog(`[СИСТЕМА] Ошибка обновления: ${message}`);
    scheduleRetry(message);
  });

  autoUpdater.checkForUpdatesAndNotify().catch((error) => {
    const message = error?.message || String(error || "Неизвестная ошибка");
    sendLog(`[СИСТЕМА] Ошибка обновления: ${message}`);
    scheduleRetry(message);
  });
}

app.whenReady().then(() => {
  setupUserFiles();
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
