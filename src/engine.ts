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
  filters?: string[];
  cost?: string[];
}

export interface BotSettings {
  base_url: string;
  max_pages_to_search?: number;
  headless?: boolean;
  browser_path?: string;
  supabase_url?: string;
  supabase_key?: string;
  supabase_table?: string;
  supabase_allow_service_role?: boolean;
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

  // Utility to mask secrets before logging
  private maskSecret(value: string): string {
    if (value.length <= 8) return "***";
    return `${value.slice(0, 8)}***`;
  }

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

  private async writeNotFoundFallback(record: any, reason: string) {
    const filePath = path.join(this.userDataPath, "not_found.jsonl");
    const payload = { ...record, reason };
    try {
      await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`);
      this.logStep(
        "INFO",
        `Not-found saved locally (${reason}).`,
        "writeNotFoundFallback",
      );
    } catch (e: any) {
      this.logStep(
        "ERROR",
        `Failed to save not-found: ${e.message}`,
        "writeNotFoundFallback",
      );
    }
  }

  private getSupabaseKeyRole(key: string): string | null {
    const parts = key.split(".");
    if (parts.length !== 3) return null;
    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64").toString("utf-8"),
      );
      return payload?.role || null;
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      // Explicitly notify that the provided token was invalid
      this.logStep(
        "ERROR",
        `Failed to parse Supabase JWT payload: ${errMessage}`,
        "getSupabaseKeyRole",
      );
      return null;
    }
  }

  private async saveNotFoundToSupabase(record: any) {
    const settings = this.config.settings;
    const supabaseUrl = settings.supabase_url || process.env.SUPABASE_URL;
    const supabaseKey = settings.supabase_key || process.env.SUPABASE_ANON_KEY;
    const supabaseTable = settings.supabase_table || "not_found_products";
    const allowServiceRole = settings.supabase_allow_service_role === true;

    if (!supabaseUrl || !supabaseKey) {
      await this.writeNotFoundFallback(record, "supabase_not_configured");
      return;
    }

    const maskedSupabaseKey = this.maskSecret(supabaseKey);
    const sanitizeLogText = (text: string) =>
      text.split(supabaseKey).join(maskedSupabaseKey).slice(0, 200);

    const keyRole = this.getSupabaseKeyRole(supabaseKey);
    if (keyRole === "service_role" && !allowServiceRole) {
      this.logStep(
        "ERROR",
        "Supabase service_role key is blocked. Use an anon key.",
        "saveNotFoundToSupabase",
      );
      await this.writeNotFoundFallback(record, "supabase_service_role_blocked");
      return;
    }

    if (typeof fetch !== "function") {
      await this.writeNotFoundFallback(record, "fetch_unavailable");
      return;
    }

    const endpoint = `${String(supabaseUrl).replace(/\/$/, "")}/rest/v1/${supabaseTable}`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(record),
      });

      if (!response.ok) {
        const rawError = await response.text().catch(() => "");
        const safeError = sanitizeLogText(rawError);
        await this.writeNotFoundFallback(record, `supabase_${response.status}`);
        this.logStep(
          "ERROR",
          `Supabase error: ${response.status} ${safeError}`,
          "saveNotFoundToSupabase",
        );
        return;
      }

      this.logStep(
        "SUCCESS",
        "Not-found saved to Supabase.",
        "saveNotFoundToSupabase",
      );
    } catch (e: any) {
      await this.writeNotFoundFallback(record, "supabase_exception");
      const rawMessage = e?.message ? String(e.message) : String(e);
      const safeMessage = sanitizeLogText(rawMessage);
      this.logStep(
        "ERROR",
        `Supabase exception: ${safeMessage}`,
        "saveNotFoundToSupabase",
      );
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
    } catch (_) {
      pageTitle = "";
    }

    const record = {
      keyword: task.keyword,
      target_name: task.target_name,
      search_url: page.url(),
      page_title: pageTitle,
      filters: task.filters || [],
      cost: task.cost || [],
      search_time_ms: searchTimeMs,
      max_pages_to_search: maxPagesToSearch,
      page_number_reached: pageNumberReached,
      cards_scanned: cardsScanned,
      created_at: new Date().toISOString(),
    };

    await this.saveNotFoundToSupabase(record);
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

      defaultPaths.push(
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        path.join(
          localAppData,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        ),
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      );
    } else if (platform === "darwin") {
      defaultPaths.push(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      );
    }

    for (const candidate of defaultPaths) {
      if (existsSync(candidate)) return candidate;
    }

    throw new Error(
      "Browser executable path not found. Set CHROME_PATH, provide browser_path in config.json, or install Google Chrome.",
    );
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
      this.logStep(
        "INFO",
        `Found browser executable at: ${browserPath}`,
        "launchBrowser",
      );

      const profileDir = path.join(this.userDataPath, "chrome_debug_profile");
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
        "--incognito",
        "-inprivate",
        "--private",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--lang=ko-KR",
        "--new-window",
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
      const [adTextCount, adClassCount] = await Promise.all([
        card.locator('span:has-text("AD")').count(),
        card.locator('[class*="AdMark"]').count(),
      ]);
      return adTextCount > 0 || adClassCount > 0;
    } catch (_) {
      return false;
    }
  }

  private async expandAllFilters(root: Page | Locator) {
    const moreBtns = root.locator(
      'button:has-text("더보기"), .search-filter-options-more, .btn-more-filter, .filter-function-bar-list-btn:has-text("더보기")',
    );

    // Some sections reveal additional "+ 더보기" buttons after expansion,
    // so do a few passes instead of a single static count.
    for (let pass = 0; pass < 6; pass++) {
      const count = await this.safeExecute(
        moreBtns.count(),
        "counting 'more' buttons",
        0,
      );

      if (count === 0) break;
      if (pass === 0) {
        this.logStep(
          "INFO",
          `Found ${count} "more filters" buttons.`,
          "expandAllFilters",
        );
      }

      let clickedAny = false;
      for (let i = 0; i < count; i++) {
        const isVisible = await this.safeExecute(
          moreBtns.nth(i).isVisible({ timeout: 500 }),
          `checking visibility of 'more' button ${i}`,
          false,
        );
        if (!isVisible) continue;

        try {
          this.logStep(
            "ACTION",
            `Clicking "more filters" (${i + 1}/${count}).`,
            "expandAllFilters",
          );
          await moreBtns.nth(i).click({ timeout: 3000 });
          clickedAny = true;
          await Humanizer.wait(300, 600);
        } catch (error) {
          const errMessage =
            error instanceof Error ? error.message : String(error);
          this.logStep(
            "ERROR",
            `Could not click "more filters" button ${i}: ${errMessage}`,
            "expandAllFilters",
          );
        }
      }

      if (!clickedAny) break;
    }
  }

  private async applyFilters(page: Page, filters: string[]) {
    if (!filters?.length) return;
    const clickTimeoutMs = 3500;
    const normalizeText = (text: string) =>
      text.normalize("NFC").replace(/\s+/g, " ").trim();
    const escapeRegExp = (text: string) =>
      text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const makeExactMatcher = (text: string) => {
      const normalized = normalizeText(text);
      const exactWithSpaces = escapeRegExp(normalized).replace(/\s+/g, "\\s+");
      return new RegExp(`^\\s*${exactWithSpaces}\\s*$`, "i");
    };
    this.logStep(
      "INFO",
      `Applying filters: ${filters.join(", ")}`,
      "applyFilters",
    );
    await Humanizer.wait(1500, 2500);

    // 1. Locate the filter panel so we do not click the whole page.
    // On Coupang, filters typically live in #searchOptionForm or .search-filters.
    const filterPanel = page
      .locator(
        "#searchOptionForm, .search-filter-options, .search-filters, .filter-function-bar",
      )
      .first();

    const panelCount = await this.safeExecute(
      filterPanel.count(),
      "counting filter panel",
      0,
    );
    const searchRoot = panelCount > 0 ? filterPanel : page;

    if (panelCount === 0) {
      this.logStep(
        "WARN",
        "Filter panel not found. Falling back to page-level filter search.",
        "applyFilters",
      );
    }

    // 2. Expand hidden filter groups within the detected filter area.
    await this.expandAllFilters(searchRoot);

    for (const f of filters) {
      // Coupang can re-fold sections after each filter application.
      await this.expandAllFilters(searchRoot);
      await Humanizer.wait(200, 400);

      let clicked = false;
      const filterLower = f.toLowerCase();
      const matcher = makeExactMatcher(f);
      const filterText = normalizeText(f);

      if (!filterText) {
        this.logStep("WARN", "Empty filter value. Skipping.", "applyFilters");
        continue;
      }

      const tryClick = async (loc: Locator, label: string) => {
        const totalCandidates = await this.safeExecute(
          loc.count(),
          `counting filter candidates (${label})`,
          0,
        );

        for (let i = 0; i < Math.min(totalCandidates, 6); i++) {
          const el = loc.nth(i);
          const isVisible = await this.safeExecute(
            el.isVisible({ timeout: 500 }),
            `checking filter visibility (${label})`,
            false,
          );
          if (!isVisible) continue;

          const cls = (await el.getAttribute("class").catch(() => "")) || "";
          const parentClass =
            (await el
              .locator("xpath=ancestor::li[1]")
              .getAttribute("class")
              .catch(() => "")) || "";
          if (cls.includes("disabled") || parentClass.includes("disabled")) {
            continue;
          }

          if (cls.includes("selected") || parentClass.includes("selected")) {
            this.logStep(
              "DEBUG",
              `Filter is already selected (${label}).`,
              "applyFilters",
            );
            return true;
          }

          await el.scrollIntoViewIfNeeded().catch(() => undefined);
          await Humanizer.move(page, el);
          let normalErr = "";
          let forceErr = "";
          try {
            await el.click({ timeout: clickTimeoutMs });
            return true;
          } catch (error) {
            normalErr = error instanceof Error ? error.message : String(error);

            // Some filter labels toggle via the asset icon inside the label.
            try {
              const asset = el.locator("i.filter-function-bar-asset").first();
              const assetVisible = await asset
                .isVisible({ timeout: 300 })
                .catch(() => false);
              if (assetVisible) {
                await asset.click({ timeout: 1000, force: true });
                return true;
              }
            } catch (_) {}

            // Fallback when the label is covered by sticky elements or transitions.
            try {
              await el.click({ timeout: 1000, force: true });
              return true;
            } catch (forceError) {
              forceErr =
                forceError instanceof Error
                  ? forceError.message
                  : String(forceError);

              // Final fallback: invoke native click without Playwright actionability checks.
              const nativeClicked = await el
                .evaluate((node) => {
                  (node as HTMLElement).click();
                  return true;
                })
                .catch(() => false);
              if (nativeClicked) {
                return true;
              }

              this.logStep(
                "DEBUG",
                `Failed to click filter (${label}). normal="${normalErr}" force="${forceErr}"`,
                "applyFilters",
              );
            }
          }
        }

        return false;
      };

      // STEP 1: Check hardcoded/system filters (Delivery, Availability).
      // These are often icon-based or complex, so we use explicit locators.
      if (
        filterLower.includes("품절") ||
        filterLower.includes("out of stock")
      ) {
        const el = searchRoot
          .locator(
            "label.search-filter-exclude-out-of-stock, input#outOfStockProduct + label",
          )
          .first();
        clicked = await tryClick(el, "out of stock");
      } else if (
        filterLower.includes("rocket") ||
        filterLower.includes("로켓")
      ) {
        const el = searchRoot
          .locator('label[data-component-name*="deliveryFilterOption-rocket"]')
          .first();
        clicked = await tryClick(el, "rocket");
      } else if (
        filterLower.includes("무료배송") ||
        filterLower.includes("free shipping")
      ) {
        const el = searchRoot
          .locator('label[data-component-name*="deliveryFilterOption-free"]')
          .first();
        clicked = await tryClick(el, "free shipping");
      } else if (
        filterLower.includes("새 상품") ||
        filterLower.includes("new product")
      ) {
        const el = searchRoot
          .locator(".filter-function-bar-attribute label:not(.disabled)", {
            hasText: /^\s*새\s*상품\s*$/,
          })
          .first();
        clicked = await tryClick(el, "new product");
      }

      if (clicked) {
        this.logStep(
          "SUCCESS",
          `Filter found and applied: "${f}"`,
          "applyFilters",
        );
      }

      // STEP 2: Dynamic/semantic search (sizes, brands, colors, materials, ratings).
      if (!clicked) {
        const textLocators = [
          searchRoot
            .locator(".filter-function-bar-attribute label:not(.disabled)")
            .filter({ hasText: matcher }),
          searchRoot
            .locator(".filter-function-bar-rating label:not(.disabled)")
            .filter({ hasText: matcher }),
          searchRoot
            .locator(".filter-function-bar-category a")
            .filter({ hasText: matcher }),
          searchRoot
            .locator("label:not(.disabled)")
            .filter({ hasText: matcher }),
          searchRoot.locator("a").filter({ hasText: matcher }),
          searchRoot.locator("button").filter({ hasText: matcher }),
        ];

        for (const loc of textLocators) {
          const clickedHere = await tryClick(loc, "text");
          if (clickedHere) {
            clicked = true;
            this.logStep(
              "SUCCESS",
              `Filter found and applied: "${f}"`,
              "applyFilters",
            );
            break;
          }
        }
      }

      // Wait for the product list to reload after a click.
      if (clicked) {
        await page
          .waitForLoadState("domcontentloaded", { timeout: 5000 })
          .catch(() => undefined);
        await Humanizer.wait(1500, 2500);
      } else {
        this.logStep(
          "WARN",
          `Filter not found: "${f}". Skipping.`,
          "applyFilters",
        );
      }
    }
  }

  private async applyCost(page: Page, costFilters: string[]) {
    if (!costFilters?.length) return;
    this.logStep(
      "INFO",
      `Applying price filters: ${costFilters.join(", ")}`,
      "applyCost",
    );
    const norm = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const ct of costFilters) {
      try {
        await page.evaluate(() =>
          window.scrollTo({
            top: document.body.scrollHeight * 0.7,
            behavior: "smooth",
          }),
        );
        await Humanizer.wait(1500, 2000);
        let clicked = false;
        const all = page.locator(".filter-function-bar-price-item");
        const cnt = await all.count().catch(() => 0);
        for (let i = 0; i < cnt; i++) {
          const txt = await all
            .nth(i)
            .innerText({ timeout: 1000 })
            .catch(() => "");
          if (norm(txt) === norm(ct) || norm(txt).includes(norm(ct))) {
            await Humanizer.move(page, all.nth(i));
            await all.nth(i).click();
            await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
            await Humanizer.wait(1500, 2500);
            this.logStep(
              "SUCCESS",
              `Price filter applied: "${norm(txt)}"`,
              "applyCost",
            );
            clicked = true;
            break;
          }
        }
        if (!clicked) {
          this.logStep("DEBUG", `Price filter not found: "${ct}"`, "applyCost");
        }
      } catch (e: any) {
        this.logStep("ERROR", `Price filter error: ${e.message}`, "applyCost");
      }
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    await Humanizer.wait(800, 1500);
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

        if ((await page.title()).includes("Access Denied")) {
          this.logStep("ERROR", "Blocked by site.", "run");
          break;
        }

        if (task.filters?.length) await this.applyFilters(page, task.filters);
        if (task.cost?.length) await this.applyCost(page, task.cost);

        let found = false;
        const maxP = this.config.settings.max_pages_to_search || 3;
        const targetFragment = task.target_name
          .trim()
          .split(" ")
          .slice(0, 4)
          .join(" ");
        this.logStep(
          "DEBUG",
          `Target fragment for matching: "${targetFragment}"`,
          "run",
        );

        for (let pageNum = 1; pageNum <= maxP; pageNum++) {
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
            const nameMatches = name
              .toLowerCase()
              .includes(targetFragment.toLowerCase());
            if (nameMatches) {
              this.logStep(
                "SUCCESS",
                `PAGE ${pageNum} card #${cardNumber} matched target (name contains "${targetFragment}")`,
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
                `PAGE ${pageNum} card #${cardNumber} skipped: no match to "${targetFragment}"`,
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
        await Humanizer.wait(pause * 1000, pause * 1000 + 4000);
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
      if (this.browserProcess && !this.browserProcess.killed) {
        try {
          this.browserProcess.kill();
        } catch (_) {}
      }
    }
  }
}
