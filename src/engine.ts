import * as patchright from "patchright";
import { Page, Locator, Browser, BrowserContext, chromium } from "patchright";
import { promises as fs, existsSync } from "fs";
import * as path from "path";
import { spawn, ChildProcess } from "child_process";
import * as os from "os";
import { Humanizer, getFreePort, isCDPReady, waitForCDP } from "./utils";

export interface Task {
  keyword: string;
  target_name: string;
}

export interface BotSettings {
  base_url: string;
  max_pages_to_search?: number;
  headless?: boolean;
  browser_path?: string;
}

export interface BotConfig {
  settings: BotSettings;
  tasks: Task[];
}

export interface Selectors {
  search_bar: string;
  add_to_cart_btn: string;
  search_button?: string;
  cart_link?: string;
}

export interface BotResult {
  id: number;
  date: string;
  keyword: string;
  targetName: string;
  location: string;
}

type LogLevel =
  | "INFO"
  | "DEBUG"
  | "WARN"
  | "SKIP"
  | "ACTION"
  | "SUCCESS"
  | "ERROR";

export class AutomationEngine {
  private config!: BotConfig;
  private selectors!: Selectors;
  // Store the active port so launch and connect use the same value
  private currentDebugPort = 9222;
  private resultCounter = 0;
  private cancelled = false;
  private browserKilled = false;
  private browserProcess: ChildProcess | null = null;

  private userDataPath: string;
  private logFilePath: string;
  private readonly portLockFile: string;
  private logWriteQueue: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.userDataPath = userDataPath;
    this.logFilePath = path.join(this.userDataPath, "bot_log.txt");
    this.portLockFile = path.join(this.userDataPath, "debug_port.lock");
  }

  private async readPortLock(): Promise<number | null> {
    try {
      const raw = await fs.readFile(this.portLockFile, "utf-8");
      const port = parseInt(raw.trim(), 10);
      if (Number.isFinite(port) && port > 0 && port <= 65535) return port;
    } catch (_) {
      // Missing file is expected on first run.
    }
    return null;
  }

  private async writePortLock(port: number): Promise<void> {
    try {
      await fs.writeFile(this.portLockFile, String(port), "utf-8");
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logStep(
        "ERROR",
        `Failed to write port lock: ${errMessage}`,
        "writePortLock",
      );
    }
  }

  public onLog?: (msg: string) => void;
  public onResult?: (data: BotResult) => void;

  // Internal logging helper
  private log(msg: string) {
    console.log(msg); // Keep console output for local debugging
    // Keep log-file writes ordered without blocking the hot path.
    this.logWriteQueue = this.logWriteQueue
      .then(() => fs.appendFile(this.logFilePath, `${msg}\n`, "utf-8"))
      .catch(() => {});
    if (this.onLog) this.onLog(msg); // Forward to the UI
  }

  private logStep(level: LogLevel, message: string, context?: string) {
    const ctx = context ? `[${context}] ` : "";
    this.log(`[${level}] ${ctx}${message}`);
  }

  private emitResult(task: Task, pageNumber: number, position: number) {
    this.resultCounter += 1;
    const dateStr = new Date().toLocaleDateString("en-GB").replace(/\//g, ".");
    const location = `Page ${pageNumber} Position ${position}`;
    const payload: BotResult = {
      id: this.resultCounter,
      date: dateStr,
      keyword: task.keyword,
      targetName: task.target_name,
      location,
    };
    if (this.onResult) this.onResult(payload);
  }

  public cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.logStep("WARN", "Stop requested by user. Winding down...", "cancel");
  }

  // Cleanly tear down a browser we spawned. On Windows, plain SIGTERM only
  // signals the parent — renderer/helper children stay alive and hold the
  // user-data-dir lock. taskkill /T /F walks the tree.
  private async killBrowserProcess(): Promise<void> {
    if (!this.browserProcess || this.browserKilled) return;
    const pid = this.browserProcess.pid;
    this.browserKilled = true;
    if (!pid) return;

    try {
      if (process.platform === "win32") {
        await new Promise<void>((resolve) => {
          const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
          killer.once("exit", () => resolve());
          killer.once("error", () => resolve());
        });
      } else {
        this.browserProcess.kill();
      }
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logStep(
        "ERROR",
        `Failed to terminate browser ${pid}: ${errMessage}`,
        "killBrowserProcess",
      );
    }
  }

  // Like Humanizer.wait, but bails out early on cancellation so Stop feels
  // responsive during long inter-task pauses.
  private async cancellableWait(min: number, max: number): Promise<void> {
    const total = Math.floor(Math.random() * (max - min + 1) + min);
    const start = Date.now();
    while (Date.now() - start < total) {
      if (this.cancelled) return;
      const remaining = total - (Date.now() - start);
      await new Promise((r) => setTimeout(r, Math.min(150, remaining)));
    }
  }

  /**
   * Safely executes a Promise, logging any errors with context instead of failing silently.
   * @param action The Promise to execute.
   * @param context A description of the operation for logging purposes.
   * @param fallback The value to return if the action throws an error.
   */
  private async safeExecute<T>(
    action: Promise<T>,
    context: string,
    fallback: T,
  ): Promise<T> {
    try {
      return await action;
    } catch (error) {
      // Extract the message safely whether the error is an Error object or a string
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logStep(
        "ERROR",
        `Failed during: ${context}. Reason: ${errMessage}`,
        "safeExecute",
      );
      return fallback;
    }
  }

  private async reportNotFound(
    task: Task,
    page: Page,
    searchTimeMs: number,
    maxPagesToSearch: number,
    pageNumberReached: number,
    cardsScanned: number,
  ) {
    let pageTitle = "";
    try {
      pageTitle = await page.title();
    } catch (_) {}

    const lines = [
      `=== NOT FOUND ===`,
      `keyword: ${task.keyword}`,
      `target_name: ${task.target_name}`,
      `pages_reached: ${pageNumberReached}/${maxPagesToSearch}`,
      `cards_scanned: ${cardsScanned}`,
      `search_time_ms: ${searchTimeMs}`,
      `search_url: ${page.url()}`,
      `page_title: ${pageTitle}`,
      `=================`,
    ];
    for (const line of lines) {
      this.logStep("WARN", line, "reportNotFound");
    }
  }

  private async loadConfigs() {
    const configRaw = await fs.readFile(
      path.join(this.userDataPath, "config.json"),
      "utf-8",
    );
    const selectorsRaw = await fs.readFile(
      path.join(this.userDataPath, "selectors.json"),
      "utf-8",
    );
    this.config = JSON.parse(configRaw) as BotConfig;
    this.selectors = JSON.parse(selectorsRaw) as Selectors;
  }

  /**
   * Determines the executable path for the browser.
   * Prioritizes config and environment variables for flexible overrides.
   */
  private findBrowserPath(customConfigPath?: string): string {
    if (customConfigPath && existsSync(customConfigPath)) {
      return customConfigPath;
    }

    const envPath =
      process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
    if (envPath && existsSync(envPath)) {
      return envPath;
    }

    const platform = os.platform();
    const defaultPaths: string[] = [];

    if (platform === "win32") {
      const localAppData =
        process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
      const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
      const programFilesX86 =
        process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

      defaultPaths.push(
        // Chrome (most reliable for stealth — preferred)
        path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
        // Edge
        path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
        // Brave
        path.join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        path.join(programFilesX86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        path.join(localAppData, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        // Vivaldi
        path.join(localAppData, "Vivaldi", "Application", "vivaldi.exe"),
        path.join(programFiles, "Vivaldi", "Application", "vivaldi.exe"),
        // Opera / Opera GX
        path.join(localAppData, "Programs", "Opera", "opera.exe"),
        path.join(localAppData, "Programs", "Opera GX", "opera.exe"),
        // Chromium
        path.join(localAppData, "Chromium", "Application", "chrome.exe"),
      );
    } else if (platform === "darwin") {
      defaultPaths.push(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
        "/Applications/Opera.app/Contents/MacOS/Opera",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
      );
    }

    for (const candidate of defaultPaths) {
      if (existsSync(candidate)) return candidate;
    }

    throw new Error(
      "Browser executable path not found. Set CHROME_PATH, provide browser_path in config.json, or install Google Chrome.",
    );
  }

  // Map a resolved executable path to a friendly name and the browser's
  // private-browsing CLI flag. Chrome and forks like Brave/Vivaldi/Chromium
  // use --incognito; Edge uses -inprivate; Opera uses --private.
  private static detectBrowser(
    browserPath: string,
  ): { name: string; privateFlag: string } {
    const p = browserPath.toLowerCase();
    if (/msedge|microsoft[\\/ ]edge/.test(p))
      return { name: "Edge", privateFlag: "-inprivate" };
    if (/brave/.test(p)) return { name: "Brave", privateFlag: "--incognito" };
    if (/opera/.test(p)) return { name: "Opera", privateFlag: "--private" };
    if (/vivaldi/.test(p))
      return { name: "Vivaldi", privateFlag: "--incognito" };
    if (/chromium/.test(p))
      return { name: "Chromium", privateFlag: "--incognito" };
    if (/chrome/.test(p)) return { name: "Chrome", privateFlag: "--incognito" };
    return { name: "Unknown Chromium-based", privateFlag: "--incognito" };
  }

  private async launchBrowser() {
    try {
      // Allocate the port before any filesystem checks to aid debugging
      this.currentDebugPort = await getFreePort(this.currentDebugPort);
      this.logStep(
        "INFO",
        `Allocated dynamic debugging port: ${this.currentDebugPort}`,
        "launchBrowser",
      );

      const browserPath = this.findBrowserPath(
        this.config?.settings?.browser_path,
      );
      const { name: browserName, privateFlag } =
        AutomationEngine.detectBrowser(browserPath);
      this.logStep(
        "INFO",
        `Found browser executable at: ${browserPath} (${browserName} — using ${privateFlag})`,
        "launchBrowser",
      );
      if (browserName !== "Chrome") {
        this.logStep(
          "WARN",
          `${browserName} private mode is more likely to trigger Coupang RET9999 than Chrome incognito. If searches start getting blocked, install Chrome.`,
          "launchBrowser",
        );
      }

      const profileDir = path.join(this.userDataPath, "chrome_debug_profile");
      // Wipe any leftover profile from a prior run so each launch starts
      // clean — same end result as incognito for our purposes, without
      // tripping Coupang's RET9999 anti-bot (which true --incognito does).
      try {
        await fs.rm(profileDir, { recursive: true, force: true });
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error);
        this.logStep(
          "WARN",
          `Could not wipe profile before launch (continuing): ${errMessage}`,
          "launchBrowser",
        );
      }
      if (!existsSync(profileDir)) {
        try {
          await fs.mkdir(profileDir, { recursive: true });
        } catch (error) {
          const errMessage =
            error instanceof Error ? error.message : String(error);
          // We must explicitly log system-level write errors
          this.logStep(
            "ERROR",
            `Failed to create user profile directory at ${profileDir}: ${errMessage}`,
            "launchBrowser",
          );
        }
      }

      const args = [
        `--remote-debugging-port=${this.currentDebugPort}`,
        `--remote-debugging-address=127.0.0.1`,
        `--user-data-dir=${profileDir}`,
        // Real incognito: --incognito + a starting URL forces Chrome to open
        // the URL in an incognito window (the visible badge appears). Without
        // the URL, Chrome often ignores --incognito for new-tab windows.
        // Note: incognito is a known anti-bot signal. If Coupang starts
        // returning RET9999, drop --incognito and rely on the per-run profile
        // wipe instead.
        privateFlag,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--lang=ko-KR",
        "--new-window",
        "https://www.coupang.com",
      ];

      this.logStep(
        "ACTION",
        `Launching browser: ${browserPath}`,
        "launchBrowser",
      );
      const child = spawn(browserPath, args, {
        stdio: "ignore",
        detached: true,
      });
      this.browserProcess = child;
      await this.writePortLock(this.currentDebugPort);
      child.unref();
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logStep(
        "ERROR",
        `Failed to launch browser: ${errMessage}`,
        "launchBrowser",
      );
      throw error;
    }
  }

  private async findCards(
    page: Page,
  ): Promise<{ loc: Locator | null; count: number }> {
    const selectors = [
      "li.ProductUnit_productUnit__Qd6sv",
      'li[class*="ProductUnit"]',
      "ul.ProductList li",
      ".search-product-list li",
    ];
    for (const sel of selectors) {
      const l = page.locator(sel);
      const c = await l.count().catch(() => 0);
      if (c > 0) {
        this.logStep(
          "DEBUG",
          `Selector "${sel}" matched ${c} cards.`,
          "findCards",
        );
        return { loc: l, count: c };
      }
    }
    this.logStep("DEBUG", "No cards found with known selectors.", "findCards");
    return { loc: null, count: 0 };
  }

  private async getName(card: Locator): Promise<string> {
    const selectors = [
      ".ProductUnit_productNameV2__cV9cw",
      '[class*="productName"]',
      ".product-name",
      "span.name",
      "dt.title",
    ];
    for (const sel of selectors) {
      try {
        const t = await card.locator(sel).first().innerText({ timeout: 800 });
        if (t?.trim()) return t.trim();
      } catch (_) {}
    }
    return "";
  }

  private async isAdCard(card: Locator): Promise<boolean> {
    try {
      const [enCount, koCount, ariaCount, classCount] = await Promise.all([
        card.locator('span:has-text("AD")').count(),
        card.locator('span:has-text("광고")').count(),
        card.locator('button[aria-label="Ad information"]').count(),
        card.locator('[class*="AdMark"]').count(),
      ]);
      return enCount > 0 || koCount > 0 || ariaCount > 0 || classCount > 0;
    } catch (_) {
      return false;
    }
  }

  async run(): Promise<string | null> {
    await this.loadConfigs();

    // Create screenshots folder under user data where we have write access.
    const shots = path.join(this.userDataPath, "screenshots");
    try {
      await fs.access(shots);
    } catch {
      await fs.mkdir(shots, { recursive: true });
    }

    const savedPort = await this.readPortLock();
    if (savedPort !== null) {
      this.currentDebugPort = savedPort;
      this.logStep(
        "INFO",
        `Restored debug port from lock file: ${this.currentDebugPort}`,
        "run",
      );
    }

    this.logStep(
      "INFO",
      `Checking debug port ${this.currentDebugPort}...`,
      "run",
    );
    if (!(await isCDPReady(this.currentDebugPort))) {
      this.logStep(
        "ACTION",
        "Browser is closed. Launching automatically...",
        "run",
      );
      await this.launchBrowser();
      if (!(await waitForCDP(this.currentDebugPort, 15000))) {
        throw new Error("Failed to connect to the browser.");
      }
    }

    this.logStep("ACTION", "Connecting to browser...", "run");
    let browser: Browser | null = null;
    try {
      browser = await patchright.chromium.connectOverCDP(
        `http://127.0.0.1:${this.currentDebugPort}`,
      );
    } catch (e: any) {
      throw new Error(`Connection error: ${e.message}`);
    }

    const contexts = browser.contexts();
    this.logStep(
      "DEBUG",
      `Browser exposed ${contexts.length} context(s) over CDP. (2 expected if --incognito took effect: default + incognito)`,
      "run",
    );
    const ctx: BrowserContext | undefined =
      contexts.find((c) => c.pages().length > 0) ?? contexts[0];

    if (!ctx) {
      await browser.close();
      throw new Error(
        "No browser context available. The browser may have launched but not initialized yet.",
      );
    }

    const pages: Page[] = ctx.pages();
    if (pages.length === 0) {
      this.logStep(
        "WARN",
        "No existing pages in context. Opening a new tab.",
        "run",
      );
    }
    let page: Page | undefined =
      pages.find((p: Page) => p.url().includes("coupang.com")) || pages[0];

    if (!page) {
      page = await ctx.newPage();
      await page.goto("https://www.coupang.com", {
        waitUntil: "load",
        timeout: 60000,
      });
    } else {
      await page.bringToFront();
      if (page.url() === "about:blank" || page.url().includes("newtab")) {
        await page.goto("https://www.coupang.com", {
          waitUntil: "load",
          timeout: 60000,
        });
      }
    }

    const title = await page.title();
    this.logStep("INFO", `Landing page title: "${title}"`, "run");
    this.logStep("INFO", `Current URL: ${page.url()}`, "run");
    if (title.includes("Access Denied") || title.includes("Robot")) {
      await browser.close();
      throw new Error("Browser blocked by site (Access Denied).");
    }
    this.logStep("SUCCESS", "Connection successful!", "run");

    ctx.on("page", (p: Page) => {
      p.on("dialog", async (d: any) => d.accept());
    });
    page.on("dialog", async (d: any) => d.accept());
    await Humanizer.randomMove(page);
    await Humanizer.wait(800, 1500);

    const recoverPageIfClosed = async (): Promise<boolean> => {
      if (page && !page.isClosed()) return true;

      const replacement =
        ctx
          .pages()
          .find((p) => !p.isClosed() && p.url().includes("coupang.com")) ||
        ctx.pages().find((p) => !p.isClosed());

      if (!replacement) {
        this.logStep(
          "ERROR",
          "All browser pages are closed. Stopping run.",
          "run",
        );
        return false;
      }

      page = replacement;
      await page.bringToFront().catch(() => undefined);
      this.logStep(
        "WARN",
        "Active page was closed. Switched to another open page.",
        "run",
      );
      return true;
    };

    try {
      let shouldStopRun = false;
      for (const task of this.config.tasks) {
        if (this.cancelled) {
          shouldStopRun = true;
          break;
        }
        if (shouldStopRun) break;
        if (!(await recoverPageIfClosed())) {
          shouldStopRun = true;
          break;
        }

        const searchStartedAt = Date.now();
        let lastPageReached = 0;
        let cardsScanned = 0;
        this.logStep(
          "INFO",
          `Starting search for keyword "${task.keyword}"`,
          "run",
        );
        this.logStep("INFO", `Target name: "${task.target_name}"`, "run");
        this.logStep("INFO", `Current URL: ${page.url()}`, "run");

        const inp = page.locator(this.selectors.search_bar).first();
        const inputVisible = await this.safeExecute(
          inp.isVisible({ timeout: 3000 }),
          "checking search input visibility",
          false,
        );
        if (!inputVisible) {
          this.logStep(
            "ACTION",
            `Search input not visible. Navigating to ${this.config.settings.base_url}.`,
            "run",
          );
          await page.goto(this.config.settings.base_url, {
            waitUntil: "load",
            timeout: 60000,
          });
          await Humanizer.wait(2000, 3500);
        }
        this.logStep("ACTION", "Focusing search input.", "run");
        await Humanizer.move(page, inp);
        await inp.click({ clickCount: 3 });
        await Humanizer.wait(150, 350);
        await inp.fill("");
        this.logStep("ACTION", `Typing keyword "${task.keyword}".`, "run");
        await inp.type(task.keyword, { delay: 100 + Math.random() * 80 });
        await Humanizer.wait(400, 900);
        if (Math.random() > 0.5) await Humanizer.wait(600, 1500);
        this.logStep("ACTION", "Submitting search.", "run");
        await page.keyboard.press("Enter");
        await page.waitForLoadState("load", { timeout: 30000 });
        await Humanizer.wait(2000, 4000);
        this.logStep("INFO", `Search results URL: ${page.url()}`, "run");

        const pageTitle = await page.title();
        if (pageTitle.includes("Access Denied") || pageTitle.includes("Robot")) {
          this.logStep("ERROR", "Blocked by site (Access Denied).", "run");
          break;
        }

        const bodyText = await page
          .evaluate(() => document.body?.innerText?.slice(0, 500) || "")
          .catch(() => "");
        if (/"rCode"\s*:\s*"RET\d+"/.test(bodyText)) {
          this.logStep(
            "ERROR",
            `SEARCH_BLOCKED keyword="${task.keyword}" body="${bodyText.slice(0, 200).replace(/\s+/g, " ")}"`,
            "run",
          );
          await page
            .goto(this.config.settings.base_url, {
              waitUntil: "load",
              timeout: 30000,
            })
            .catch(() => undefined);
          await Humanizer.wait(3000, 5000);
          continue;
        }

        let found = false;
        const maxP = this.config.settings.max_pages_to_search || 3;
        const normalizeName = (s: string) =>
          s.toLowerCase().replace(/\s+/g, " ").trim();
        const targetNormalized = normalizeName(task.target_name);
        this.logStep(
          "DEBUG",
          `Target for matching: "${targetNormalized}"`,
          "run",
        );

        for (let pageNum = 1; pageNum <= maxP; pageNum++) {
          if (this.cancelled) {
            shouldStopRun = true;
            break;
          }
          if (!(await recoverPageIfClosed())) {
            shouldStopRun = true;
            break;
          }

          lastPageReached = pageNum;
          this.logStep("INFO", `PAGE ${pageNum}/${maxP} scanning`, "run");
          await page.evaluate(() => window.scrollBy(0, 400));
          await Humanizer.wait(600, 1400);
          await Humanizer.randomMove(page);

          const { loc: cards, count } = await this.findCards(page);
          this.logStep("INFO", `PAGE ${pageNum} cards found: ${count}`, "run");
          if (!cards || count === 0) {
            this.logStep(
              "INFO",
              `PAGE ${pageNum} no product cards found.`,
              "run",
            );
            break;
          }

          let nonAdCount = 0;
          for (let i = 0; i < count; i++) {
            if (this.cancelled) {
              shouldStopRun = true;
              break;
            }
            if (!(await recoverPageIfClosed())) {
              shouldStopRun = true;
              break;
            }

            const card = cards.nth(i);
            const cardNumber = i + 1;
            this.logStep(
              "INFO",
              `PAGE ${pageNum} processing card #${cardNumber}`,
              "run",
            );
            const cardVisible = await this.safeExecute(
              card.isVisible({ timeout: 200 }),
              "checking card visibility",
              true,
            );
            if (!cardVisible) {
              this.logStep(
                "SKIP",
                `PAGE ${pageNum} card #${cardNumber} skipped: not visible`,
                "run",
              );
              continue;
            }
            if (await this.isAdCard(card)) {
              this.logStep(
                "SKIP",
                `PAGE ${pageNum} card #${cardNumber} skipped: AD detected`,
                "run",
              );
              continue;
            }
            nonAdCount += 1;
            cardsScanned += 1;
            const name = await this.getName(card);
            if (!name) {
              this.logStep(
                "SKIP",
                `PAGE ${pageNum} card #${cardNumber} skipped: missing title`,
                "run",
              );
              continue;
            }
            this.logStep(
              "DEBUG",
              `PAGE ${pageNum} card #${cardNumber} title: "${name}"`,
              "run",
            );
            const nameMatches =
              normalizeName(name).includes(targetNormalized);
            if (nameMatches) {
              this.logStep(
                "SUCCESS",
                `PAGE ${pageNum} card #${cardNumber} matched target (name contains "${targetNormalized}")`,
                "run",
              );
              this.emitResult(task, pageNum, cardNumber);
              await Humanizer.move(page, card);
              await Humanizer.wait(400, 800);

              this.logStep(
                "ACTION",
                `PAGE ${pageNum} clicking card #${cardNumber}`,
                "run",
              );
              const [np] = await Promise.all([
                ctx.waitForEvent("page"),
                card.locator("a").first().click(),
              ]);
              await np.waitForLoadState("load", { timeout: 30000 });
              await Humanizer.wait(1500, 2500);

              this.logStep("INFO", `Product page loaded: ${np.url()}`, "run");
              this.logStep("INFO", "Reading product page.", "run");
              await Humanizer.simulateReading(np, 15000, 20000);

              let cartOk = false;
              const cartSelectors = [
                this.selectors.add_to_cart_btn,
                "button.prod-cart-btn",
              ];
              for (const sel of cartSelectors) {
                const btn = np.locator(sel).first();
                const isVisible = await this.safeExecute(
                  btn.isVisible({ timeout: 3000 }),
                  "checking add-to-cart button visibility",
                  false,
                );
                if (isVisible) {
                  await Humanizer.move(np, btn);
                  await Humanizer.wait(400, 900);
                  try {
                    this.logStep(
                      "ACTION",
                      "Clicking add-to-cart button.",
                      "run",
                    );
                    await btn.click();
                    this.logStep("SUCCESS", "Added to cart.", "run");
                    cartOk = true;
                    break;
                  } catch (error) {
                    const errMessage =
                      error instanceof Error ? error.message : String(error);
                    this.logStep(
                      "ERROR",
                      `Failed to click add-to-cart button: ${errMessage}`,
                      "run",
                    );
                  }
                }
              }
              if (!cartOk) {
                this.logStep(
                  "ERROR",
                  "Add-to-cart button not found or click failed.",
                  "run",
                );
              }
              await Humanizer.wait(800, 1500);
              await np.close();
              await page.bringToFront();
              await Humanizer.wait(800, 1500);
              found = true;
              break;
            } else {
              this.logStep(
                "SKIP",
                `PAGE ${pageNum} card #${cardNumber} skipped: no match to "${targetNormalized}"`,
                "run",
              );
            }
          }
          this.logStep(
            "DEBUG",
            `PAGE ${pageNum} non-ad cards: ${nonAdCount}`,
            "run",
          );
          if (nonAdCount === 0) {
            this.logStep(
              "INFO",
              `PAGE ${pageNum} no non-ad product cards found.`,
              "run",
            );
            break;
          }
          if (shouldStopRun) break;
          if (found) break;

          let nextOk = false;
          const nextSelectors = [
            "a.btn-next",
            ".pagination-next",
            'a[aria-label="다음"]',
          ];
          for (const sel of nextSelectors) {
            const next = page.locator(sel).first();
            const isVisible = await this.safeExecute(
              next.isVisible({ timeout: 2000 }),
              "checking pagination next button visibility",
              false,
            );
            if (isVisible) {
              await Humanizer.move(page, next);
              try {
                this.logStep(
                  "ACTION",
                  `PAGE ${pageNum} clicking next page`,
                  "run",
                );
                await next.click();
                await page.waitForLoadState("domcontentloaded", {
                  timeout: 30000,
                });
                await Humanizer.wait(1500, 3000);
                this.logStep("INFO", `PAGE ${pageNum + 1} loaded`, "run");
                nextOk = true;
                break;
              } catch (error) {
                const errMessage =
                  error instanceof Error ? error.message : String(error);
                this.logStep(
                  "ERROR",
                  `Failed to click pagination next: ${errMessage}`,
                  "run",
                );
              }
            }
          }
          if (!nextOk) {
            this.logStep(
              "INFO",
              `PAGE ${pageNum} no next page button found. Stopping pagination.`,
              "run",
            );
            break;
          }
        }

        if (shouldStopRun) break;

        if (!found) {
          this.logStep(
            "ERROR",
            `Target not found: "${task.target_name.slice(0, 35)}..."`,
            "run",
          );
          this.logStep(
            "INFO",
            `Search summary: pages=${lastPageReached}, cards=${cardsScanned}`,
            "run",
          );
          const searchTimeMs = Date.now() - searchStartedAt;
          await this.reportNotFound(
            task,
            page,
            searchTimeMs,
            maxP,
            lastPageReached,
            cardsScanned,
          );
        }
        const pause = Math.floor(Math.random() * 6 + 5);
        this.logStep("DEBUG", `Pausing ${pause}s before next task.`, "run");
        await this.cancellableWait(pause * 1000, pause * 1000 + 4000);
      }

      if (shouldStopRun) {
        this.logStep(
          "WARN",
          "Run stopped early due closed pages. Skipping cart step.",
          "run",
        );
        return null;
      }

      if (!(await recoverPageIfClosed())) {
        this.logStep(
          "WARN",
          "No active page before cart step. Skipping cart page.",
          "run",
        );
        return null;
      }

      this.logStep("INFO", "Opening cart page.", "run");
      await page.goto("https://cart.coupang.com/cartView.pang", {
        waitUntil: "load",
        timeout: 30000,
      });
      await Humanizer.wait(8000, 12000);

      const file = `${Humanizer.date()}_final_cart.png`;
      const screenshotPath = path.join(shots, file);

      const cartContainerSelectors = [
        "body > div:nth-child(4) > div > div > div.twc-bg-white.max-md\\:twc-mx-\\[20px\\].max-csm\\:twc-mx-0 > div > div.twc-flex.max-mobile\\:twc-mx-\\[16px\\].max-mobile\\:twc-mt-\\[16px\\]",
        "#cartTable",
        ".cart-item-list",
        ".commerce-cart-content",
      ];

      let shotDone = false;
      for (const sel of cartContainerSelectors) {
        const container = page.locator(sel).first();
        if (await container.isVisible({ timeout: 5000 }).catch(() => false)) {
          this.logStep("ACTION", "Capturing cart items area.", "run");
          await container.screenshot({ path: screenshotPath });
          shotDone = true;
          break;
        }
      }

      if (!shotDone) {
        this.logStep(
          "DEBUG",
          "Cart container not found. Taking a regular screenshot.",
          "run",
        );
        await page.screenshot({ path: screenshotPath, fullPage: false });
      }

      this.logStep("SUCCESS", `Screenshot saved: ${file}`, "run");
      return screenshotPath; // Return the file path for the UI open button
    } catch (e: any) {
      this.logStep("ERROR", `Execution error: ${e.message}`, "run");
      return null;
    } finally {
      if (browser) {
        try {
          this.logStep("ACTION", "Closing browser.", "run");
          await browser.close();
        } catch (_) {}
      }
      await this.killBrowserProcess();
    }
  }
}
