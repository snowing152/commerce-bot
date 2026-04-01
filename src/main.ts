import { app, BrowserWindow, ipcMain, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import { AutomationEngine } from "./engine";

let autoUpdater: any = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch (error) {
  const errMessage = error instanceof Error ? error.message : String(error);
  console.warn(
    `[setupAutoUpdater] electron-updater unavailable: ${errMessage}`,
  );
}

// Get the system user data folder (on Windows this is AppData/Roaming/Coupang Bot)
const USER_DATA_PATH = app.getPath("userData");
let autoUpdaterInitialized = false;
let updateRetryTimer: NodeJS.Timeout | null = null;
let updateRetryAttempt = 0;
const UPDATE_RETRY_BASE_MS = 15000;
const UPDATE_RETRY_MAX_MS = 300000;
// Keep a strong reference to the window to avoid accidental GC.
let mainWindow: BrowserWindow | null = null;

// Handler for retrieving the app version
ipcMain.handle("get-version", () => {
  return app.getVersion();
});

const SESSION_FILE_NAME = "saved_session.json";

function escapeMarkdownV2(text: string) {
  return text.replace(/([\\_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

// 1. Save session data
ipcMain.handle("save-session", async (_event, data) => {
  try {
    const sessionPath = path.join(USER_DATA_PATH, SESSION_FILE_NAME);
    fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2), "utf-8");
    return { success: true };
  } catch (error) {
    console.error("Failed to save session:", error);
    return { success: false };
  }
});

// 2. Load session data
ipcMain.handle("load-session", async () => {
  try {
    const sessionPath = path.join(USER_DATA_PATH, SESSION_FILE_NAME);
    if (fs.existsSync(sessionPath)) {
      const data = fs.readFileSync(sessionPath, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Failed to load session:", error);
  }
  return null;
});

// 3. Send logs to Telegram
ipcMain.handle("send-log-telegram", async () => {
  try {
    const userConfigPath = path.join(USER_DATA_PATH, "config.json");
    const defaultConfigPath = path.join(__dirname, "../config/config.json");
    let configRaw: string | null = null;

    if (fs.existsSync(userConfigPath)) {
      configRaw = fs.readFileSync(userConfigPath, "utf-8");
    } else if (fs.existsSync(defaultConfigPath)) {
      configRaw = fs.readFileSync(defaultConfigPath, "utf-8");
    }

    if (!configRaw) {
      throw new Error("config.json not found");
    }

    const config = JSON.parse(configRaw);
    const { bot_token, chat_id } = config.telegram || {};

    if (!bot_token || !chat_id) {
      throw new Error("Telegram token or chat_id is missing in config.json");
    }

    const logPath = path.join(USER_DATA_PATH, "bot_log.txt");

    if (!fs.existsSync(logPath)) {
      throw new Error(
        "\u0424\u0430\u0439\u043b \u043b\u043e\u0433\u043e\u0432 \u0435\u0449\u0435 \u043d\u0435 \u0441\u043e\u0437\u0434\u0430\u043d.",
      );
    }

    const logContent = fs.readFileSync(logPath, "utf-8");
    const textToSend =
      logContent.length > 4000 ? "... " + logContent.slice(-3900) : logContent;
    const escapedText = escapeMarkdownV2(textToSend);

    const url = `https://api.telegram.org/bot${bot_token}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id,
        text: `\ud83e\udd16 *Coupang Bot Logs:*\n\n\`\`\`text\n${escapedText}\n\`\`\``,
        parse_mode: "MarkdownV2",
      }),
    });

    if (!response.ok) {
      throw new Error("Telegram API error: " + response.statusText);
    }

    return { success: true };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errMessage };
  }
});

// Safely copy base configs on first launch
function setupUserFiles() {
  const configDest = path.join(USER_DATA_PATH, "config.json");
  const selectorsDest = path.join(USER_DATA_PATH, "selectors.json");

  // Source files inside the packaged app archive
  const configSrc = path.join(__dirname, "../config/config.json");
  const selectorsSrc = path.join(__dirname, "../config/selectors.json");

  try {
    // --- config.json ---
    if (!fs.existsSync(configSrc)) {
      // Default config missing in build.
      console.warn("[setupUserFiles] Default config.json not found in build.");
    } else if (!fs.existsSync(configDest)) {
      // First run: copy defaults.
      fs.copyFileSync(configSrc, configDest);
      console.log("[setupUserFiles] Config initialized from defaults.");
    } else {
      // Existing user config: merge with defaults.
      try {
        const defaultConfig = JSON.parse(fs.readFileSync(configSrc, "utf-8"));
        const userConfig = JSON.parse(fs.readFileSync(configDest, "utf-8"));

        // 1. telegram: use defaults from build.
        const mergedTelegram = { ...defaultConfig.telegram };

        // 2. settings: use defaults but preserve user's browser_path.
        const mergedSettings = {
          ...defaultConfig.settings,
          // Preserve user browser_path (even empty) since user knows their install.
          browser_path: userConfig.settings?.browser_path ?? "",
        };

        // 3. tasks: keep user's tasks, fallback to defaults if missing.
        const mergedTasks = Array.isArray(userConfig.tasks)
          ? userConfig.tasks
          : defaultConfig.tasks;

        const merged = {
          settings: mergedSettings,
          telegram: mergedTelegram,
          tasks: mergedTasks,
        };

        fs.writeFileSync(configDest, JSON.stringify(merged, null, 2), "utf-8");
        console.log("[setupUserFiles] Config updated from new build.");
      } catch (error) {
        // Keep user config if merge fails.
        console.warn(
          "[setupUserFiles] Failed to merge config, keeping existing:",
          error,
        );
      }
    }

    // Always copy selectors (force refresh of the locator baseline)
    if (fs.existsSync(selectorsSrc)) {
      fs.copyFileSync(selectorsSrc, selectorsDest);
    }
  } catch (error) {
    // Prevent startup crash if AppData is locked or unavailable.
    console.error("Critical error configuring user files:", error);
  }
}

function createWindow() {
  const webPreferences = {
    preload: path.join(__dirname, "preload.js"),
    nodeIntegration: false,
    contextIsolation: true,
    enableRemoteModule: false,
  } as Electron.WebPreferences & { enableRemoteModule: false };

  mainWindow = new BrowserWindow({
    width: 550,
    height: 650,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "../assets/icon.ico"),
    webPreferences,
  });

  mainWindow.loadFile(path.join(__dirname, "../src/index.html"));

  mainWindow.webContents.once("did-finish-load", () => {
    if (mainWindow) setupAutoUpdater(mainWindow);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Manages the update workflow
function setupAutoUpdater(win: BrowserWindow) {
  if (!autoUpdater) {
    win.webContents.send(
      "update-status",
      "Модуль автообновления недоступен в этой сборке.",
    );
    return;
  }

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
      autoUpdater.checkForUpdatesAndNotify().catch((error: any) => {
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
    // Send status text to the main screen
    sendStatus("Найдено обновление. Загрузка в фоне...");
    sendLog("[СИСТЕМА] Найдено обновление. Начинаю загрузку...");
  });

  autoUpdater.on("update-not-available", () => {
    updateRetryAttempt = 0;
    clearUpdateError();
    sendStatus("Установлена последняя версия");
  });

  autoUpdater.on("download-progress", (progressObj: any) => {
    const percent = Math.max(0, Math.min(100, Math.round(progressObj.percent)));
    sendProgress(percent);
    // Show the percentage on the main screen
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

  autoUpdater.on("error", (error: any) => {
    const message = error?.message || String(error || "Неизвестная ошибка");
    sendLog(`[СИСТЕМА] Ошибка обновления: ${message}`);
    scheduleRetry(message);
  });

  autoUpdater.checkForUpdatesAndNotify().catch((error: any) => {
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
    // Read and write in the permitted AppData directory
    const configPath = path.join(USER_DATA_PATH, "config.json");

    const rawConfig = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(rawConfig);

    config.tasks = tasksArray;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Pass the AppData path to the engine so it can save screenshots there
    const engine = new AutomationEngine(USER_DATA_PATH);

    engine.onLog = (msg) => event.reply("bot-log", msg);
    engine.onResult = (data) => {
      if (!event.sender.isDestroyed()) event.reply("bot-result", data);
    };

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
