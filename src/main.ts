import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.join(__dirname, "../.env") });

import { app, BrowserWindow, ipcMain, shell } from "electron";
import {
  getSubscriptionStatus,
  openPaymentBot,
  startTelegramAuth,
  checkAuthToken,
} from "./auth-service";
import Store from "electron-store";
import * as fs from "fs";
import { AutomationEngine } from "./engine";

// ── Auto updater (optional, graceful fallback) ──────────────
let autoUpdater: any = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch (error) {
  const errMessage = error instanceof Error ? error.message : String(error);
  console.warn(`[setupAutoUpdater] electron-updater unavailable: ${errMessage}`);
}

// ── App paths & state ───────────────────────────────────────
const USER_DATA_PATH       = app.getPath("userData");
let autoUpdaterInitialized = false;
let updateRetryTimer: NodeJS.Timeout | null = null;
let updateRetryAttempt     = 0;
const UPDATE_RETRY_BASE_MS = 15000;
const UPDATE_RETRY_MAX_MS  = 300000;
const SESSION_FILE_NAME    = "saved_session.json";

// ── Store (typed) ───────────────────────────────────────────
interface StoreSchema {
  telegram_id?: number;
  session?: string;
}
const store = new Store<StoreSchema>();

// ── Window reference ────────────────────────────────────────
let win: BrowserWindow;

// ── Helper: load HTML page relative to dist/ ────────────────
function loadPage(page: string) {
  win.loadFile(path.join(__dirname, page));
}

// ═══════════════════════════════════════════════════════════
//  IPC HANDLERS  (each registered exactly once)
// ═══════════════════════════════════════════════════════════

ipcMain.handle("get-version", () => app.getVersion());

ipcMain.handle("get-bot-username", () => process.env.BOT_USERNAME);

// ── Session ─────────────────────────────────────────────────
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

// ── Send logs to Telegram ────────────────────────────────────
function escapeMarkdownV2(text: string) {
  return text.replace(/([\\_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

ipcMain.handle("send-log-telegram", async () => {
  try {
    const userConfigPath    = path.join(USER_DATA_PATH, "config.json");
    const defaultConfigPath = path.join(__dirname, "../config/config.json");
    let configRaw: string | null = null;

    if (fs.existsSync(userConfigPath)) {
      configRaw = fs.readFileSync(userConfigPath, "utf-8");
    } else if (fs.existsSync(defaultConfigPath)) {
      configRaw = fs.readFileSync(defaultConfigPath, "utf-8");
    }

    if (!configRaw) throw new Error("config.json not found");

    const config = JSON.parse(configRaw);
    const { bot_token, chat_id } = config.telegram || {};
    if (!bot_token || !chat_id) {
      throw new Error("Telegram token or chat_id is missing in config.json");
    }

    const logPath = path.join(USER_DATA_PATH, "bot_log.txt");
    if (!fs.existsSync(logPath)) {
      throw new Error("Файл логов ещё не создан.");
    }

    const logContent  = fs.readFileSync(logPath, "utf-8");
    const textToSend  = logContent.length > 4000
      ? "... " + logContent.slice(-3900)
      : logContent;
    const escapedText = escapeMarkdownV2(textToSend);

    const url      = `https://api.telegram.org/bot${bot_token}/sendMessage`;
    const response = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        chat_id,
        text:       `🤖 *Coupang Bot Logs:*\n\n\`\`\`text\n${escapedText}\n\`\`\``,
        parse_mode: "MarkdownV2",
      }),
    });

    if (!response.ok) throw new Error("Telegram API error: " + response.statusText);
    return { success: true };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errMessage };
  }
});

// ── Auth & Subscription ──────────────────────────────────────
ipcMain.handle("get-subscription-status", async () => {
  const telegramId = store.get("telegram_id");
  if (!telegramId) throw new Error("Not logged in");
  return getSubscriptionStatus(telegramId);
});

ipcMain.handle("open-payment-bot", () => openPaymentBot());

ipcMain.handle("logout", () => {
  store.delete("telegram_id");
  store.delete("session");
});

ipcMain.handle("navigate-to", (_, page: "auth" | "subscription" | "main") => {
  const pages: Record<string, string> = {
    auth:         "auth.html",
    subscription: "subscription.html",
    main:         "index.html",
  };
  win.loadFile(path.join(__dirname, pages[page]));
});

ipcMain.handle("start-telegram-auth", async () => {
  return startTelegramAuth();
});

ipcMain.handle("check-auth-token", async (_, token: string) => {
  const result = await checkAuthToken(token);
  if (result.success && result.telegramId) {
    store.set("telegram_id", result.telegramId);
  }
  return result;
});

// ── Bot runner ───────────────────────────────────────────────
ipcMain.on("start-bot", async (event, tasksArray) => {
  try {
    const configPath = path.join(USER_DATA_PATH, "config.json");
    const rawConfig  = fs.readFileSync(configPath, "utf-8");
    const config     = JSON.parse(rawConfig);

    config.tasks = tasksArray;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const engine    = new AutomationEngine(USER_DATA_PATH);
    engine.onLog    = (msg)  => event.reply("bot-log", msg);
    engine.onResult = (data) => {
      if (!event.sender.isDestroyed()) event.reply("bot-result", data);
    };

    const screenshotPath = await engine.run();
    event.reply("bot-done", screenshotPath);
  } catch (error: any) {
    event.reply("bot-log",  `[КРИТИЧЕСКАЯ ОШИБКА] ${error.message}`);
    event.reply("bot-done", null);
  }
});

ipcMain.on("open-path", (_event, p) => {
  if (p) shell.showItemInFolder(p);
});

// ═══════════════════════════════════════════════════════════
//  USER FILES SETUP
// ═══════════════════════════════════════════════════════════

function setupUserFiles() {
  const configDest   = path.join(USER_DATA_PATH, "config.json");
  const selectorsDest = path.join(USER_DATA_PATH, "selectors.json");
  const configSrc    = path.join(__dirname, "../config/config.json");
  const selectorsSrc = path.join(__dirname, "../config/selectors.json");

  try {
    if (!fs.existsSync(configSrc)) {
      console.warn("[setupUserFiles] Default config.json not found in build.");
    } else if (!fs.existsSync(configDest)) {
      fs.copyFileSync(configSrc, configDest);
      console.log("[setupUserFiles] Config initialized from defaults.");
    } else {
      try {
        const defaultConfig = JSON.parse(fs.readFileSync(configSrc, "utf-8"));
        const userConfig    = JSON.parse(fs.readFileSync(configDest, "utf-8"));

        const merged = {
          settings: {
            ...defaultConfig.settings,
            browser_path: userConfig.settings?.browser_path ?? "",
          },
          telegram: { ...defaultConfig.telegram },
          tasks:    Array.isArray(userConfig.tasks)
            ? userConfig.tasks
            : defaultConfig.tasks,
        };

        fs.writeFileSync(configDest, JSON.stringify(merged, null, 2), "utf-8");
        console.log("[setupUserFiles] Config updated from new build.");
      } catch (error) {
        console.warn("[setupUserFiles] Failed to merge config, keeping existing:", error);
      }
    }

    if (fs.existsSync(selectorsSrc)) {
      fs.copyFileSync(selectorsSrc, selectorsDest);
    }
  } catch (error) {
    console.error("Critical error configuring user files:", error);
  }
}

// ═══════════════════════════════════════════════════════════
//  WINDOW CREATION
// ═══════════════════════════════════════════════════════════

async function createWindow() {
  win = new BrowserWindow({
    width:           550,
    height:          650,
    autoHideMenuBar: true,
    icon:            path.join(__dirname, "../assets/icon.ico"),
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });

  const telegramId = store.get("telegram_id");

  if (!telegramId) {
    loadPage("auth.html");
  } else {
    try {
      const { status } = await getSubscriptionStatus(telegramId);
      loadPage(status === "expired" ? "subscription.html" : "index.html");
    } catch {
      store.delete("telegram_id");
      loadPage("auth.html");
    }
  }

  win.webContents.once("did-finish-load", () => {
    setupAutoUpdater(win);
  });
}

// ═══════════════════════════════════════════════════════════
//  AUTO UPDATER
// ═══════════════════════════════════════════════════════════

function setupAutoUpdater(win: BrowserWindow) {
  if (!autoUpdater) {
    win.webContents.send("update-status", "Модуль автообновления недоступен.");
    return;
  }

  if (autoUpdaterInitialized) return;
  autoUpdaterInitialized = true;

  if (!app.isPackaged) {
    win.webContents.send("update-status", "Автообновление доступно только в собранной версии.");
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
    if (!win.isDestroyed()) win.webContents.send("update-error", { message, retryInSec, attempt });
  };
  const clearUpdateError = () => sendUpdateError(null, null, null);

  const scheduleRetry = (message: string) => {
    updateRetryAttempt += 1;
    const delay      = Math.min(UPDATE_RETRY_MAX_MS, UPDATE_RETRY_BASE_MS * Math.pow(2, updateRetryAttempt - 1));
    const retryInSec = Math.ceil(delay / 1000);

    if (updateRetryTimer) clearTimeout(updateRetryTimer);

    sendUpdateError(message, retryInSec, updateRetryAttempt);
    sendStatus(`Ошибка обновления. Повтор через ${retryInSec} сек.`);

    updateRetryTimer = setTimeout(() => {
      if (!win.isDestroyed()) sendStatus("Повторяю проверку обновлений...");
      autoUpdater.checkForUpdatesAndNotify().catch((error: any) => {
        scheduleRetry(error?.message || String(error || "Неизвестная ошибка"));
      });
    }, delay);
  };

  autoUpdater.autoDownload        = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    clearUpdateError();
    sendStatus("Проверяю обновления...");
  });

  autoUpdater.on("update-available", () => {
    updateRetryAttempt = 0;
    clearUpdateError();
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
    sendStatus(`Скачивание обновления: ${percent}%`);
  });

  autoUpdater.on("update-downloaded", () => {
    updateRetryAttempt = 0;
    clearUpdateError();
    sendStatus("Обновление готово. Перезапуск...");
    sendLog("[СИСТЕМА] Обновление загружено. Перезапуск через 3 секунды...");
    setTimeout(() => autoUpdater.quitAndInstall(), 3000);
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

// ═══════════════════════════════════════════════════════════
//  APP LIFECYCLE
// ═══════════════════════════════════════════════════════════

app.whenReady().then(async () => {
  setupUserFiles();
  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});