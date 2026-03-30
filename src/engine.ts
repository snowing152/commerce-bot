import * as patchright from "patchright";
import { Page, Locator, Browser, BrowserContext, chromium } from "patchright";
import { promises as fs, existsSync } from "fs";
import * as path from "path";
import { spawn } from "child_process";
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

export class AutomationEngine {
  private config!: BotConfig;
  private selectors!: Selectors;
  // Store the active port so launch and connect use the same value
  private currentDebugPort = 9222;

  private userDataPath: string;

  constructor(userDataPath: string) {
    this.userDataPath = userDataPath;
  }

  public onLog?: (msg: string) => void;

  // Internal logging helper
  private log(msg: string) {
    console.log(msg); // Keep console output for local debugging
    if (this.onLog) this.onLog(msg); // Forward to the UI
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
      this.log(`[ERROR] Failed during: ${context}. Reason: ${errMessage}`);
      return fallback;
    }
  }

  private async writeNotFoundFallback(record: any, reason: string) {
    const filePath = path.join(this.userDataPath, "not_found.jsonl");
    const payload = { ...record, reason };
    try {
      await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`);
      this.log(`  [INFO] Not-found saved locally (${reason}).`);
    } catch (e: any) {
      this.log(`  [WARNING] Failed to save not-found: ${e.message}`);
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
      this.log(`[ERROR] Failed to parse Supabase JWT payload: ${errMessage}`);
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

    const keyRole = this.getSupabaseKeyRole(supabaseKey);
    if (keyRole === "service_role" && !allowServiceRole) {
      this.log(
        "  [WARNING] Supabase service_role key is blocked. Use an anon key.",
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
        const errorText = await response.text().catch(() => "");
        await this.writeNotFoundFallback(record, `supabase_${response.status}`);
        this.log(`  [WARNING] Supabase error: ${response.status} ${errorText}`);
        return;
      }

      this.log("  [SUCCESS] Not-found saved to Supabase.");
    } catch (e: any) {
      await this.writeNotFoundFallback(record, "supabase_exception");
      this.log(`  [WARNING] Supabase exception: ${e.message}`);
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
      this.log(
        `[INFO] Allocated dynamic debugging port: ${this.currentDebugPort}`,
      );

      const browserPath = this.findBrowserPath(
        this.config?.settings?.browser_path,
      );
      this.log(`[INFO] Found browser executable at: ${browserPath}`);

      const profileDir = path.join(this.userDataPath, "chrome_debug_profile");
      if (!existsSync(profileDir)) {
        try {
          await fs.mkdir(profileDir, { recursive: true });
        } catch (error) {
          const errMessage =
            error instanceof Error ? error.message : String(error);
          // We must explicitly log system-level write errors
          this.log(
            `[ERROR] Failed to create user profile directory at ${profileDir}: ${errMessage}`,
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

      this.log(`[INFO] Launching browser: ${browserPath}`);
      const child = spawn(browserPath, args, {
        stdio: "ignore",
        detached: true,
      });
      child.unref();
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.log(`[CRITICAL ERROR] Failed to launch browser: ${errMessage}`);
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
        this.log(`  Cards: "${sel}" (${c})`);
        return { loc: l, count: c };
      }
    }
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
        const t = await card.locator(sel).first().innerText({ timeout: 1500 });
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

  private async expandAllFilters(page: Page) {
    const moreBtns = page.locator(
      'button:has-text("더보기"), .search-filter-options-more, .btn-more-filter',
    );
    // Using safeExecute to prevent silent count failures
    const count = await this.safeExecute(
      moreBtns.count(),
      "counting 'more' buttons",
      0,
    );

    for (let i = 0; i < count; i++) {
      const isVisible = await this.safeExecute(
        moreBtns.nth(i).isVisible({ timeout: 500 }),
        `checking visibility of 'more' button ${i}`,
        false,
      );

      if (isVisible) {
        // Wrap the click action in a try/catch so one failure does not break the entire loop
        try {
          await moreBtns.nth(i).click();
          await Humanizer.wait(300, 600);
        } catch (error) {
          const errMessage =
            error instanceof Error ? error.message : String(error);
          this.log(
            `[WARNING] Could not click 'more' button ${i}: ${errMessage}`,
          );
        }
      }
    }
  }

  private async applyFilters(page: Page, filters: string[]) {
    if (!filters?.length) return;
    await Humanizer.wait(1500, 2500);

    // 1. Expand all hidden filter groups (click every "더보기" / "More" button).
    await this.expandAllFilters(page);

    // 2. Locate the filter panel so we do not click the whole page.
    // On Coupang, filters typically live in #searchOptionForm or .search-filters.
    const filterPanel = page
      .locator("#searchOptionForm, .search-filter-options, .search-filters")
      .first();

    for (const f of filters) {
      let clicked = false;
      const filterLower = f.toLowerCase();

      // STEP 1: Check hardcoded/system filters (Delivery, Availability).
      // These are often icon-based or complex, so we use explicit locators.
      if (
        filterLower.includes("품절") ||
        filterLower.includes("out of stock")
      ) {
        const el = page
          .locator(
            "label.search-filter-exclude-out-of-stock, input#outOfStockProduct + label",
          )
          .first();
        const isVisible = await this.safeExecute(
          el.isVisible({ timeout: 1500 }),
          "checking filter visibility (out of stock)",
          false,
        );
        if (isVisible) {
          try {
            await el.click();
            clicked = true;
          } catch (error) {
            const errMessage =
              error instanceof Error ? error.message : String(error);
            this.log(
              `[ERROR] Failed to click filter element (out of stock): ${errMessage}`,
            );
          }
        }
      } else if (
        filterLower.includes("rocket") ||
        filterLower.includes("로켓")
      ) {
        const el = page.locator('label[data-component-name*="rocket"]').first();
        const isVisible = await this.safeExecute(
          el.isVisible({ timeout: 1500 }),
          "checking filter visibility (rocket)",
          false,
        );
        if (isVisible) {
          try {
            await el.click();
            clicked = true;
          } catch (error) {
            const errMessage =
              error instanceof Error ? error.message : String(error);
            this.log(
              `[ERROR] Failed to click filter element (rocket): ${errMessage}`,
            );
          }
        }
      }

      // STEP 2: Dynamic/semantic search (sizes, brands, colors, materials, ratings).
      if (!clicked) {
        // If the filter panel is missing (layout changed), search the whole page.
        const panelVisible = await this.safeExecute(
          filterPanel.isVisible(),
          "checking filter panel visibility",
          false,
        );
        const searchRoot = panelVisible ? filterPanel : page;

        // Use text-based locators to find elements that include the user-provided text.
        const textLocators = [
          searchRoot.locator(`label:has-text("${f}")`),
          searchRoot.locator(`a:has-text("${f}")`),
          searchRoot.locator(`button:has-text("${f}")`),
          searchRoot.locator(`span:has-text("${f}")`),
        ];

        for (const loc of textLocators) {
          // Take the first visible match.
          const el = loc.first();
          const isVisible = await this.safeExecute(
            el.isVisible({ timeout: 1000 }),
            `checking filter visibility for "${f}"`,
            false,
          );
          if (isVisible) {
            await Humanizer.move(page, el);
            try {
              await el.click();
              clicked = true;
              this.log(`  [SUCCESS] Filter found and applied: "${f}"`);
              break; // Exit the locator loop
            } catch (error) {
              const errMessage =
                error instanceof Error ? error.message : String(error);
              this.log(
                `  [ERROR] Failed to click filter element: ${errMessage}`,
              );
            }
          }
        }
      }

      // Wait for the product list to reload after a click.
      if (clicked) {
        await page.waitForLoadState("domcontentloaded", { timeout: 15000 });
        await Humanizer.wait(1500, 2500);
      } else {
        this.log(
          `  [WARNING] Filter not found: "${f}". It may be missing in this category.`,
        );
      }
    }
  }

  private async applyCost(page: Page, costFilters: string[]) {
    if (!costFilters?.length) return;
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
            this.log(`  [SUCCESS] Price: "${norm(txt)}"`);
            clicked = true;
            break;
          }
        }
        if (!clicked) this.log(`  [WARNING] Price not found: "${ct}"`);
      } catch (e: any) {
        this.log(`  [WARNING] Price filter error: ${e.message}`);
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

    this.log(`[INFO] Checking debug port ${this.currentDebugPort}...`);
    if (!(await isCDPReady(this.currentDebugPort))) {
      this.log("[INFO] Browser is closed. Launching automatically...");
      await this.launchBrowser();
      if (!(await waitForCDP(this.currentDebugPort, 15000))) {
        throw new Error("Failed to connect to the browser.");
      }
    }

    this.log("[INFO] Connecting to browser...");
    let browser: Browser;
    try {
      browser = await patchright.chromium.connectOverCDP(
        `http://127.0.0.1:${this.currentDebugPort}`,
      );
    } catch (e: any) {
      throw new Error(`Connection error: ${e.message}`);
    }

    const contexts = browser.contexts();
    const ctx: BrowserContext =
      contexts.find((c) => c.pages().length > 0) || contexts[0];

    const pages: Page[] = ctx.pages();
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
    this.log(`Page: "${title}"`);
    if (title.includes("Access Denied") || title.includes("Robot")) {
      await browser.close();
      throw new Error("Browser blocked by site (Access Denied).");
    }
    this.log("[SUCCESS] Connection successful!\n");

    ctx.on("page", (p: Page) => {
      p.on("dialog", async (d: any) => d.accept());
    });
    page.on("dialog", async (d: any) => d.accept());
    await Humanizer.randomMove(page);
    await Humanizer.wait(800, 1500);

    try {
      for (const task of this.config.tasks) {
        const searchStartedAt = Date.now();
        let lastPageReached = 0;
        let cardsScanned = 0;
        this.log(`\n=== SEARCH: ${task.keyword} ===`);

        const inp = page.locator(this.selectors.search_bar).first();
        const inputVisible = await this.safeExecute(
          inp.isVisible({ timeout: 3000 }),
          "checking search input visibility",
          false,
        );
        if (!inputVisible) {
          await page.goto(this.config.settings.base_url, {
            waitUntil: "load",
            timeout: 60000,
          });
          await Humanizer.wait(2000, 3500);
        }
        await Humanizer.move(page, inp);
        await inp.click({ clickCount: 3 });
        await Humanizer.wait(150, 350);
        await inp.fill("");
        await inp.type(task.keyword, { delay: 100 + Math.random() * 80 });
        await Humanizer.wait(400, 900);
        if (Math.random() > 0.5) await Humanizer.wait(600, 1500);
        await page.keyboard.press("Enter");
        await page.waitForLoadState("load", { timeout: 30000 });
        await Humanizer.wait(2000, 4000);

        if ((await page.title()).includes("Access Denied")) {
          this.log("[ERROR] Blocked by site.");
          break;
        }

        if (task.filters?.length) await this.applyFilters(page, task.filters);
        if (task.cost?.length) await this.applyCost(page, task.cost);

        let found = false;
        const maxP = this.config.settings.max_pages_to_search || 3;

        for (let p = 1; p <= maxP; p++) {
          lastPageReached = p;
          this.log(`  Page ${p}...`);
          await page.evaluate(() => window.scrollBy(0, 400));
          await Humanizer.wait(1200, 2500);
          await Humanizer.randomMove(page);

          const { loc: cards, count } = await this.findCards(page);
          if (!cards || count === 0) {
            this.log("  No product cards found.");
            break;
          }

          const adMarker = page.locator(
            'span:has-text("AD"), [class*="AdMark"]',
          );
          const nonAdCards = cards.filter({ hasNot: adMarker });
          const nonAdCount = await nonAdCards.count().catch(() => 0);
          if (nonAdCount === 0) {
            this.log("  No non-ad product cards found.");
            break;
          }
          for (let i = 0; i < nonAdCount; i++) {
            const card = nonAdCards.nth(i);
            if (await this.isAdCard(card)) {
              continue;
            }
            cardsScanned += 1;
            const name = await this.getName(card);
            if (!name) continue;
            const target = task.target_name
              .trim()
              .split(" ")
              .slice(0, 4)
              .join(" ");
            if (name.toLowerCase().includes(target.toLowerCase())) {
              this.log(`  [SUCCESS] Found: "${name}"`);
              await Humanizer.move(page, card);
              await Humanizer.wait(400, 800);

              const [np] = await Promise.all([
                ctx.waitForEvent("page"),
                card.locator("a").first().click(),
              ]);
              await np.waitForLoadState("load", { timeout: 30000 });
              await Humanizer.wait(1500, 2500);

              this.log("  Reading product page..."); // Previously in utils.ts
              await Humanizer.simulateReading(np);

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
                    await btn.click();
                    this.log("  [SUCCESS] Added to cart.");
                    cartOk = true;
                    break;
                  } catch (error) {
                    const errMessage =
                      error instanceof Error ? error.message : String(error);
                    this.log(
                      `  [ERROR] Failed to click add-to-cart button: ${errMessage}`,
                    );
                  }
                }
              }
              await Humanizer.wait(3000, 5000);
              await np.close();
              await page.bringToFront();
              await Humanizer.wait(800, 1500);
              found = true;
              break;
            }
          }
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
                await next.click();
                await page.waitForLoadState("domcontentloaded", {
                  timeout: 30000,
                });
                await Humanizer.wait(2500, 4500);
                nextOk = true;
                break;
              } catch (error) {
                const errMessage =
                  error instanceof Error ? error.message : String(error);
                this.log(
                  `  [ERROR] Failed to click pagination next: ${errMessage}`,
                );
              }
            }
          }
          if (!nextOk) break;
        }

        if (!found) {
          this.log(
            `  [ERROR] Not found: "${task.target_name.slice(0, 35)}..."`,
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
        const pause = Math.floor(Math.random() * 12 + 8);
        await Humanizer.wait(pause * 1000, pause * 1000 + 4000);
      }

      this.log("\n--- Cart ---");
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
          this.log("  Capturing cart items area...");
          await container.screenshot({ path: screenshotPath });
          shotDone = true;
          break;
        }
      }

      if (!shotDone) {
        this.log(
          "  [WARNING] Cart container not found. Taking a regular screenshot.",
        );
        await page.screenshot({ path: screenshotPath, fullPage: false });
      }

      this.log(`[SUCCESS] Screenshot saved: ${file}`);
      return screenshotPath; // Return the file path for the UI open button
    } catch (e: any) {
      this.log(`[ERROR] Execution error: ${e.message}`);
      return null;
    } finally {
      await browser.close();
    }
  }
}
