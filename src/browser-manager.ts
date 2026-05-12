import { promises as fs, existsSync } from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as os from 'os';
import { getFreePort } from './utils';

type LogLevel = 'INFO' | 'DEBUG' | 'WARN' | 'SKIP' | 'ACTION' | 'SUCCESS' | 'ERROR';
export type LogCallback = (level: LogLevel, message: string, context: string) => void;

export class BrowserManager {
  currentDebugPort: number;
  private browserProcess: ChildProcess | null = null;
  private browserKilled = false;
  private readonly userDataPath: string;
  private readonly portLockFile: string;
  private readonly log: LogCallback;

  constructor(userDataPath: string, startPort: number, log: LogCallback) {
    this.userDataPath = userDataPath;
    this.portLockFile = path.join(userDataPath, 'debug_port.lock');
    this.currentDebugPort = startPort;
    this.log = log;
  }

  async readPortLock(): Promise<number | null> {
    try {
      const raw = await fs.readFile(this.portLockFile, 'utf-8');
      const port = parseInt(raw.trim(), 10);
      if (Number.isFinite(port) && port > 0 && port <= 65535) return port;
    } catch (_) {
      // Missing file is expected on first run.
    }
    return null;
  }

  private async writePortLock(port: number): Promise<void> {
    try {
      await fs.writeFile(this.portLockFile, String(port), 'utf-8');
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.log('ERROR', `Failed to write port lock: ${errMessage}`, 'writePortLock');
    }
  }

  findBrowserPath(customConfigPath?: string): string {
    if (customConfigPath && existsSync(customConfigPath)) {
      return customConfigPath;
    }

    const envPath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
    if (envPath && existsSync(envPath)) {
      return envPath;
    }

    const platform = os.platform();
    const defaultPaths: string[] = [];

    if (platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

      defaultPaths.push(
        // Chrome (most reliable for stealth — preferred)
        path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        // Edge
        path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        // Brave
        path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        // Vivaldi
        path.join(localAppData, 'Vivaldi', 'Application', 'vivaldi.exe'),
        path.join(programFiles, 'Vivaldi', 'Application', 'vivaldi.exe'),
        // Opera / Opera GX
        path.join(localAppData, 'Programs', 'Opera', 'opera.exe'),
        path.join(localAppData, 'Programs', 'Opera GX', 'opera.exe'),
        // Chromium
        path.join(localAppData, 'Chromium', 'Application', 'chrome.exe'),
      );
    } else if (platform === 'darwin') {
      defaultPaths.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi',
        '/Applications/Opera.app/Contents/MacOS/Opera',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      );
    }

    for (const candidate of defaultPaths) {
      if (existsSync(candidate)) return candidate;
    }

    throw new Error(
      'Browser executable path not found. Set CHROME_PATH, provide browser_path in config.json, or install Google Chrome.',
    );
  }

  // Map a resolved executable path to a friendly name and the browser's
  // private-browsing CLI flag. Chrome and forks like Brave/Vivaldi/Chromium
  // use --incognito; Edge uses -inprivate; Opera uses --private.
  static detectBrowser(browserPath: string): { name: string; privateFlag: string } {
    const p = browserPath.toLowerCase();
    if (/msedge|microsoft[\\/ ]edge/.test(p)) return { name: 'Edge', privateFlag: '-inprivate' };
    if (/brave/.test(p)) return { name: 'Brave', privateFlag: '--incognito' };
    if (/opera/.test(p)) return { name: 'Opera', privateFlag: '--private' };
    if (/vivaldi/.test(p)) return { name: 'Vivaldi', privateFlag: '--incognito' };
    if (/chromium/.test(p)) return { name: 'Chromium', privateFlag: '--incognito' };
    if (/chrome/.test(p)) return { name: 'Chrome', privateFlag: '--incognito' };
    return { name: 'Unknown Chromium-based', privateFlag: '--incognito' };
  }

  async launch(configBrowserPath?: string): Promise<void> {
    try {
      this.currentDebugPort = await getFreePort(this.currentDebugPort);
      this.log(
        'INFO',
        `Allocated dynamic debugging port: ${this.currentDebugPort}`,
        'launchBrowser',
      );

      const browserPath = this.findBrowserPath(configBrowserPath);
      const { name: browserName, privateFlag } = BrowserManager.detectBrowser(browserPath);
      this.log(
        'INFO',
        `Found browser executable at: ${browserPath} (${browserName} — using ${privateFlag})`,
        'launchBrowser',
      );
      if (browserName !== 'Chrome') {
        this.log(
          'WARN',
          `${browserName} private mode is more likely to trigger Coupang RET9999 than Chrome incognito. If searches start getting blocked, install Chrome.`,
          'launchBrowser',
        );
      }

      const profileDir = path.join(this.userDataPath, 'chrome_debug_profile');
      // Wipe any leftover profile from a prior run so each launch starts clean.
      try {
        await fs.rm(profileDir, { recursive: true, force: true });
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error);
        this.log(
          'WARN',
          `Could not wipe profile before launch (continuing): ${errMessage}`,
          'launchBrowser',
        );
      }
      if (!existsSync(profileDir)) {
        try {
          await fs.mkdir(profileDir, { recursive: true });
        } catch (error) {
          const errMessage = error instanceof Error ? error.message : String(error);
          this.log(
            'ERROR',
            `Failed to create user profile directory at ${profileDir}: ${errMessage}`,
            'launchBrowser',
          );
        }
      }

      const args = [
        `--remote-debugging-port=${this.currentDebugPort}`,
        `--remote-debugging-address=127.0.0.1`,
        `--user-data-dir=${profileDir}`,
        privateFlag,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--lang=ko-KR',
        '--new-window',
        'https://www.coupang.com',
      ];

      this.log('ACTION', `Launching browser: ${browserPath}`, 'launchBrowser');
      const child = spawn(browserPath, args, {
        stdio: 'ignore',
        detached: true,
      });
      this.browserProcess = child;
      await this.writePortLock(this.currentDebugPort);
      child.unref();
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.log('ERROR', `Failed to launch browser: ${errMessage}`, 'launchBrowser');
      throw error;
    }
  }

  // On Windows, plain SIGTERM only signals the parent — renderer/helper children
  // stay alive and hold the user-data-dir lock. taskkill /T /F walks the tree.
  async kill(): Promise<void> {
    if (!this.browserProcess || this.browserKilled) return;
    const pid = this.browserProcess.pid;
    this.browserKilled = true;
    if (!pid) return;

    try {
      if (process.platform === 'win32') {
        await new Promise<void>((resolve) => {
          const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          });
          killer.once('exit', () => resolve());
          killer.once('error', () => resolve());
        });
      } else {
        this.browserProcess.kill();
      }
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.log('ERROR', `Failed to terminate browser ${pid}: ${errMessage}`, 'killBrowserProcess');
    }
  }
}
