import * as path from 'path';

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  Tray,
  Menu,
  nativeImage,
  Notification,
} from 'electron';
import {
  getSubscriptionStatus,
  openPaymentBot,
  startTelegramAuth,
  checkAuthToken,
} from './auth-service';
import Store from 'electron-store';
import * as fs from 'fs';
import { AutomationEngine } from './engine';

// ── Auto updater (optional, graceful fallback) ──────────────
let autoUpdater: any = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (error) {
  const errMessage = error instanceof Error ? error.message : String(error);
  console.warn(`[setupAutoUpdater] electron-updater unavailable: ${errMessage}`);
}

// ── App paths & state ───────────────────────────────────────
const USER_DATA_PATH = app.getPath('userData');
let autoUpdaterInitialized = false;
let updateRetryTimer: NodeJS.Timeout | null = null;
let updateRetryAttempt = 0;
const UPDATE_RETRY_BASE_MS = 15000;
const UPDATE_RETRY_MAX_MS = 300000;
const UPDATE_RETRY_MAX_ATTEMPTS = 10; // 2^9 * 15s >> 5min cap; stops the exponent growing unbounded
const SESSION_FILE_NAME = 'saved_session.json';
const RESULTS_FILE_NAME = 'saved_results.json';
const MAX_PERSISTED_RESULTS = 500;

// ── Store (typed) ───────────────────────────────────────────
interface StoreSchema {
  telegram_id?: number;
  session?: string;
}
const store = new Store<StoreSchema>({ name: 'auth' });

// ── Icons root (dev vs packaged) ────────────────────────────
const iconsRoot = app.isPackaged
  ? path.join(process.resourcesPath, 'iconss')
  : path.join(app.getAppPath(), 'iconss');

// ── Window reference ────────────────────────────────────────
let win: BrowserWindow;
let tray: Tray | null = null;
let isQuitting = false;

// ── Scheduler state ─────────────────────────────────────────
let scheduleTimer: NodeJS.Timeout | null = null;
let nextScheduledRun: Date | null = null;

// ── Config helpers ───────────────────────────────────────────
function readConfig(): any {
  const configPath = path.join(USER_DATA_PATH, 'config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function writeConfig(cfg: any): void {
  const configPath = path.join(USER_DATA_PATH, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8');
}

// ── Shared bot runner ────────────────────────────────────────
async function triggerRun(
  tasksArray: any[] | null,
  send: (channel: string, payload?: unknown) => void,
): Promise<void> {
  if (activeEngine) {
    send('bot-log', '[WARN] A bot run is already in progress.');
    return;
  }
  try {
    const config = readConfig();
    if (tasksArray !== null) {
      config.tasks = tasksArray;
      writeConfig(config);
    }
    if (!Array.isArray(config.tasks) || config.tasks.length === 0) return;

    const engine = new AutomationEngine(USER_DATA_PATH);
    activeEngine = engine;

    const existingResults = loadSavedResults();
    let nextResultId =
      existingResults.length > 0
        ? Math.max(0, ...existingResults.map((r: any) => Number(r.id) || 0)) + 1
        : 1;
    const currentRunId =
      existingResults.length > 0
        ? Math.max(0, ...existingResults.map((r: any) => Number(r.run_id) || 0)) + 1
        : 1;

    engine.onLog = (msg) => send('bot-log', msg);
    engine.onResult = (data) => {
      const enriched = { ...data, id: nextResultId++, run_id: currentRunId };
      existingResults.push(enriched);
      persistResults(existingResults);
      send('bot-result', enriched);
    };

    const screenshotPath = await engine.run();
    send('bot-done', screenshotPath);
  } catch (error: any) {
    send('bot-log', `[КРИТИЧЕСКАЯ ОШИБКА] ${error.message}`);
    send('bot-done', null);
  } finally {
    activeEngine = null;
  }
}

// ── Scheduler ────────────────────────────────────────────────
const SCHEDULE_JITTER_PCT = 0.15; // ±15% — randomizes interval to avoid IP-ban patterns

function clearScheduler(): void {
  if (scheduleTimer) {
    clearTimeout(scheduleTimer);
    scheduleTimer = null;
  }
  nextScheduledRun = null;
}

function jitteredDelay(intervalHours: number): number {
  const base = intervalHours * 60 * 60 * 1000;
  const jitter = base * SCHEDULE_JITTER_PCT * (Math.random() * 2 - 1); // [-15%, +15%]
  return Math.max(60_000, Math.round(base + jitter));
}

function startScheduler(intervalHours: number): void {
  clearScheduler();

  const tick = async () => {
    if (activeEngine) {
      // Bot already running — try again after a short delay
      const retryMs = 60_000;
      nextScheduledRun = new Date(Date.now() + retryMs);
      scheduleTimer = setTimeout(tick, retryMs);
      return;
    }
    const send = (channel: string, payload?: unknown) => {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    };
    if (Notification.isSupported()) {
      new Notification({ title: 'Coupang Bot', body: 'Scheduled search starting…' }).show();
    }
    await triggerRun(null, send);
    if (Notification.isSupported()) {
      new Notification({ title: 'Coupang Bot', body: 'Scheduled search complete.' }).show();
    }
    const nextMs = jitteredDelay(intervalHours);
    nextScheduledRun = new Date(Date.now() + nextMs);
    scheduleTimer = setTimeout(tick, nextMs);
  };

  const firstMs = jitteredDelay(intervalHours);
  nextScheduledRun = new Date(Date.now() + firstMs);
  scheduleTimer = setTimeout(tick, firstMs);
}

// ── Helper: load HTML page — dev server or built file ───────
function loadPage(page: string) {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) {
    // electron-vite dev: index.html → /, other pages → /auth.html etc.
    const suffix = page === 'index.html' ? '/' : `/${page}`;
    win.loadURL(`${devUrl}${suffix}`);
  } else {
    win.loadFile(path.join(app.getAppPath(), 'out/renderer', page));
  }
}

// ═══════════════════════════════════════════════════════════
//  IPC HANDLERS  (each registered exactly once)
// ═══════════════════════════════════════════════════════════

ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('get-bot-username', () => process.env.BOT_USERNAME);

// ── Session ─────────────────────────────────────────────────
ipcMain.handle('save-session', async (_event, data) => {
  try {
    const sessionPath = path.join(USER_DATA_PATH, SESSION_FILE_NAME);
    fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Failed to save session:', error);
    return { success: false };
  }
});

function loadSavedResults(): any[] {
  try {
    const p = path.join(USER_DATA_PATH, RESULTS_FILE_NAME);
    if (!fs.existsSync(p)) return [];
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistResults(results: any[]): void {
  try {
    const trimmed =
      results.length > MAX_PERSISTED_RESULTS ? results.slice(-MAX_PERSISTED_RESULTS) : results;
    fs.writeFileSync(
      path.join(USER_DATA_PATH, RESULTS_FILE_NAME),
      JSON.stringify(trimmed, null, 2),
      'utf-8',
    );
  } catch (error) {
    console.error('Failed to persist results:', error);
  }
}

ipcMain.handle('load-results', () => loadSavedResults());

ipcMain.handle('clear-results', async () => {
  try {
    const p = path.join(USER_DATA_PATH, RESULTS_FILE_NAME);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return { success: true };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errMessage };
  }
});

ipcMain.handle('export-results-csv', async () => {
  try {
    const results = loadSavedResults();
    if (results.length === 0) return { success: false, error: 'No results to export.' };

    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export results',
      defaultPath: `coupang-results-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV files', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return { success: false };

    const header = '#,Run,Date,Time,Keyword,Product,Location\n';
    const rows = results
      .map((r: any) =>
        [
          r.id ?? '',
          r.run_id ?? '',
          `"${(r.date ?? '').replace(/"/g, '""')}"`,
          `"${(r.time ?? '').replace(/"/g, '""')}"`,
          `"${(r.keyword ?? '').replace(/"/g, '""')}"`,
          `"${(r.targetName ?? '').replace(/"/g, '""')}"`,
          `"${(r.location ?? '').replace(/"/g, '""')}"`,
        ].join(','),
      )
      .join('\n');

    fs.writeFileSync(filePath, '﻿' + header + rows, 'utf-8');
    return { success: true, path: filePath };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errMessage };
  }
});

ipcMain.handle('load-session', async () => {
  try {
    const sessionPath = path.join(USER_DATA_PATH, SESSION_FILE_NAME);
    if (fs.existsSync(sessionPath)) {
      const data = fs.readFileSync(sessionPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Failed to load session:', error);
  }
  return null;
});

// ── Send logs to Telegram ────────────────────────────────────
function escapeMarkdownV2(text: string) {
  return text.replace(/([\\_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

ipcMain.handle('send-log-telegram', async () => {
  try {
    const bot_token = process.env.TELEGRAM_BOT_TOKEN;
    const chat_id = process.env.TELEGRAM_LOG_CHAT_ID;
    if (!bot_token || !chat_id) {
      throw new Error(
        'Telegram log channel not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_LOG_CHAT_ID at build time)',
      );
    }

    const logPath = path.join(USER_DATA_PATH, 'bot_log.txt');
    if (!fs.existsSync(logPath)) {
      throw new Error('Файл логов ещё не создан.');
    }

    const logContent = fs.readFileSync(logPath, 'utf-8');
    const textToSend = logContent.length > 4000 ? '... ' + logContent.slice(-3900) : logContent;
    const escapedText = escapeMarkdownV2(textToSend);

    const url = `https://api.telegram.org/bot${bot_token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id,
        text: `🤖 *Coupang Bot Logs:*\n\n\`\`\`text\n${escapedText}\n\`\`\``,
        parse_mode: 'MarkdownV2',
      }),
    });

    if (!response.ok) throw new Error('Telegram API error: ' + response.statusText);
    return { success: true };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errMessage };
  }
});

ipcMain.handle(
  'send-problem-report',
  async (_e, { type, description }: { type: string; description: string }) => {
    try {
      const bot_token = process.env.TELEGRAM_BOT_TOKEN;
      const chat_id = process.env.TELEGRAM_LOG_CHAT_ID;
      if (!bot_token || !chat_id) {
        throw new Error(
          'Telegram not configured (set TELEGRAM_BOT_TOKEN and TELEGRAM_LOG_CHAT_ID at build time)',
        );
      }

      const telegramId = store.get('telegram_id');
      const userInfo = telegramId ? `ID: ${telegramId}` : 'Unknown';

      const logPath = path.join(USER_DATA_PATH, 'bot_log.txt');
      let logLines = '(no log file yet)';
      if (fs.existsSync(logPath)) {
        const all = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
        logLines = all.slice(-50).join('\n');
      }

      const header = `🐛 *Problem Report*\n\nUser: ${escapeMarkdownV2(userInfo)}\nType: ${escapeMarkdownV2(type)}\nDescription: ${escapeMarkdownV2(description)}\n\n*Last 50 log lines:*\n`;
      const codeBlock = `\`\`\`\n${escapeMarkdownV2(logLines)}\n\`\`\``;
      const maxCodeLen = 4096 - header.length - 6;
      const safeCode =
        codeBlock.length > maxCodeLen
          ? `\`\`\`\n${escapeMarkdownV2('...' + logLines.slice(-(maxCodeLen - 20)))}\n\`\`\``
          : codeBlock;

      const url = `https://api.telegram.org/bot${bot_token}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id,
          text: header + safeCode,
          parse_mode: 'MarkdownV2',
        }),
      });

      if (!response.ok) throw new Error('Telegram API error: ' + response.statusText);
      return { success: true };
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errMessage };
    }
  },
);

// ── Auth & Subscription ──────────────────────────────────────
ipcMain.handle('get-subscription-status', async () => {
  const telegramId = store.get('telegram_id');
  if (!telegramId) throw new Error('Not logged in');
  return getSubscriptionStatus(telegramId);
});

ipcMain.handle('open-payment-bot', () => openPaymentBot());

ipcMain.handle('logout', () => {
  store.delete('telegram_id');
  store.delete('session');
});

async function resolveMainRoute(telegramId: number): Promise<string> {
  try {
    const { status } = await getSubscriptionStatus(telegramId);
    return status === 'expired' ? 'subscription.html' : 'index.html';
  } catch {
    // Backend hiccup mid-session: route to subscription page (which surfaces
    // its own error state) rather than to the dashboard or logging out.
    return 'subscription.html';
  }
}

ipcMain.handle('navigate-to', async (_, page: 'auth' | 'subscription' | 'main') => {
  if (page === 'main') {
    const tid = store.get('telegram_id');
    if (!tid) {
      loadPage('auth.html');
      return;
    }
    loadPage(await resolveMainRoute(tid));
    return;
  }
  loadPage(page === 'auth' ? 'auth.html' : 'subscription.html');
});

ipcMain.handle('start-telegram-auth', async () => {
  return startTelegramAuth();
});

ipcMain.handle('check-auth-token', async (_, token: string) => {
  const result = await checkAuthToken(token);
  if (result.success && result.telegramId) {
    store.set('telegram_id', result.telegramId);
  }
  return result;
});

ipcMain.handle('clear-chrome-debug-profile', async () => {
  const profilePath = path.join(USER_DATA_PATH, 'chrome_debug_profile');
  try {
    await fs.promises.rm(profilePath, { recursive: true, force: true });
    return { success: true, path: profilePath };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return { success: false, path: profilePath, error: errMessage };
  }
});

// ── Bot runner ───────────────────────────────────────────────
let activeEngine: AutomationEngine | null = null;

ipcMain.on('start-bot', (event, tasksArray) => {
  const send = (channel: string, payload?: unknown) => {
    if (!event.sender.isDestroyed()) event.reply(channel, payload);
  };
  triggerRun(tasksArray, send);
});

ipcMain.on('stop-bot', () => {
  activeEngine?.cancel();
});

ipcMain.handle('get-schedule', () => {
  const cfg = readConfig();
  const schedule = cfg.schedule ?? { enabled: false, intervalHours: 6 };
  return { ...schedule, nextRunAt: nextScheduledRun?.toISOString() ?? null };
});

ipcMain.handle('save-schedule', (_e, schedule: { enabled: boolean; intervalHours: number }) => {
  const cfg = readConfig();
  cfg.schedule = schedule;
  writeConfig(cfg);
  if (schedule.enabled) startScheduler(schedule.intervalHours);
  else clearScheduler();
  return { success: true };
});

ipcMain.on('open-path', (_event, p) => {
  if (p) shell.showItemInFolder(p);
});

// ═══════════════════════════════════════════════════════════
//  USER FILES SETUP
// ═══════════════════════════════════════════════════════════

function setupUserFiles() {
  const configDest = path.join(USER_DATA_PATH, 'config.json');
  const selectorsDest = path.join(USER_DATA_PATH, 'selectors.json');
  const configSrc = path.join(__dirname, '../../config/config.json');
  const selectorsSrc = path.join(__dirname, '../../config/selectors.json');

  try {
    if (!fs.existsSync(configSrc)) {
      console.warn('[setupUserFiles] Default config.json not found in build.');
    } else if (!fs.existsSync(configDest)) {
      fs.copyFileSync(configSrc, configDest);
      console.log('[setupUserFiles] Config initialized from defaults.');
    } else {
      try {
        const defaultConfig = JSON.parse(fs.readFileSync(configSrc, 'utf-8'));
        const userConfig = JSON.parse(fs.readFileSync(configDest, 'utf-8'));

        const merged = {
          settings: {
            ...defaultConfig.settings,
            browser_path: userConfig.settings?.browser_path ?? '',
          },
          tasks: Array.isArray(userConfig.tasks) ? userConfig.tasks : defaultConfig.tasks,
          schedule: userConfig.schedule ?? defaultConfig.schedule,
        };

        fs.writeFileSync(configDest, JSON.stringify(merged, null, 2), 'utf-8');
        console.log('[setupUserFiles] Config updated from new build.');
      } catch (error) {
        console.warn('[setupUserFiles] Failed to merge config, keeping existing:', error);
      }
    }

    if (fs.existsSync(selectorsSrc)) {
      fs.copyFileSync(selectorsSrc, selectorsDest);
      console.log('[setupUserFiles] Selectors refreshed from bundle.');
    }
  } catch (error) {
    console.error('Critical error configuring user files:', error);
  }
}

// ═══════════════════════════════════════════════════════════
//  WINDOW CREATION
// ═══════════════════════════════════════════════════════════

async function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    autoHideMenuBar: true,
    icon: path.join(iconsRoot, 'icons', '256x256.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Intercept close → hide to tray instead of quitting
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  // Set up system tray
  const iconPath = path.join(iconsRoot, 'icons', '16x16.png');
  let trayIcon = nativeImage.createEmpty();
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  }
  tray = new Tray(trayIcon);
  tray.setToolTip('Coupang Bot');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open',
        click: () => {
          win.show();
          win.focus();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('double-click', () => {
    win.show();
    win.focus();
  });

  const telegramId = store.get('telegram_id');

  if (!telegramId) {
    loadPage('auth.html');
  } else {
    try {
      const { status } = await getSubscriptionStatus(telegramId);
      loadPage(status === 'expired' ? 'subscription.html' : 'index.html');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'User not found') {
        // Account was removed — force re-authentication
        store.delete('telegram_id');
        loadPage('auth.html');
      } else {
        // Network/Supabase error — trust the stored session
        loadPage('index.html');
      }
    }
  }

  win.webContents.once('did-finish-load', () => {
    setupAutoUpdater(win);
  });
}

// ═══════════════════════════════════════════════════════════
//  AUTO UPDATER
// ═══════════════════════════════════════════════════════════

type UpdateStatus = { key: string; params?: Record<string, string | number> };

function setupAutoUpdater(win: BrowserWindow) {
  if (!autoUpdater) {
    win.webContents.send('update-status', { key: 'update.unavailable' } satisfies UpdateStatus);
    return;
  }

  if (autoUpdaterInitialized) return;
  autoUpdaterInitialized = true;

  if (!app.isPackaged) {
    win.webContents.send('update-status', { key: 'update.devOnly' } satisfies UpdateStatus);
    return;
  }

  const sendStatus = (status: UpdateStatus) => {
    if (!win.isDestroyed()) win.webContents.send('update-status', status);
  };
  const sendProgress = (percent: number) => {
    if (!win.isDestroyed()) win.webContents.send('update-progress', percent);
  };
  const sendLog = (msg: string) => {
    if (!win.isDestroyed()) win.webContents.send('bot-log', msg);
  };
  const sendUpdateError = (
    message: string | null,
    retryInSec: number | null,
    attempt: number | null,
  ) => {
    if (!win.isDestroyed()) win.webContents.send('update-error', { message, retryInSec, attempt });
  };
  const clearUpdateError = () => sendUpdateError(null, null, null);

  const scheduleRetry = (message: string) => {
    updateRetryAttempt = Math.min(updateRetryAttempt + 1, UPDATE_RETRY_MAX_ATTEMPTS);
    const delay = Math.min(
      UPDATE_RETRY_MAX_MS,
      UPDATE_RETRY_BASE_MS * Math.pow(2, updateRetryAttempt - 1),
    );
    const retryInSec = Math.ceil(delay / 1000);

    if (updateRetryTimer) clearTimeout(updateRetryTimer);

    sendUpdateError(message, retryInSec, updateRetryAttempt);
    sendStatus({ key: 'update.errorRetry', params: { sec: retryInSec } });

    updateRetryTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      sendStatus({ key: 'update.retrying' });
      autoUpdater.checkForUpdatesAndNotify().catch((error: any) => {
        scheduleRetry(error?.message || String(error || 'Unknown error'));
      });
    }, delay);
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    clearUpdateError();
    sendStatus({ key: 'update.checking' });
  });

  autoUpdater.on('update-available', () => {
    updateRetryAttempt = 0;
    clearUpdateError();
    sendStatus({ key: 'update.found' });
    sendLog('[SYSTEM] Update found. Starting download...');
  });

  autoUpdater.on('update-not-available', () => {
    updateRetryAttempt = 0;
    clearUpdateError();
    sendStatus({ key: 'update.uptodate' });
  });

  autoUpdater.on('download-progress', (progressObj: any) => {
    const percent = Math.max(0, Math.min(100, Math.round(progressObj.percent)));
    sendProgress(percent);
    sendStatus({ key: 'update.downloading', params: { percent } });
  });

  autoUpdater.on('update-downloaded', () => {
    updateRetryAttempt = 0;
    clearUpdateError();
    sendStatus({ key: 'update.ready' });
    sendLog('[SYSTEM] Update downloaded. Restarting in 3 seconds...');
    setTimeout(() => autoUpdater.quitAndInstall(), 3000);
  });

  autoUpdater.on('error', (error: any) => {
    const message = error?.message || String(error || 'Unknown error');
    sendLog(`[SYSTEM] Update error: ${message}`);
    scheduleRetry(message);
  });

  autoUpdater.checkForUpdatesAndNotify().catch((error: any) => {
    const message = error?.message || String(error || 'Unknown error');
    sendLog(`[SYSTEM] Update error: ${message}`);
    scheduleRetry(message);
  });
}

// ═══════════════════════════════════════════════════════════
//  APP LIFECYCLE
// ═══════════════════════════════════════════════════════════

app.whenReady().then(async () => {
  setupUserFiles();
  await createWindow();
  // Restore schedule from saved config
  try {
    const cfg = readConfig();
    const schedule = cfg.schedule as { enabled: boolean; intervalHours: number } | undefined;
    if (schedule?.enabled) startScheduler(schedule.intervalHours);
  } catch {
    // config not readable yet — skip
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  if (updateRetryTimer) {
    clearTimeout(updateRetryTimer);
    updateRetryTimer = null;
  }
  clearScheduler();
});

// App lives in the tray; do nothing when the window is hidden
app.on('window-all-closed', () => {});
