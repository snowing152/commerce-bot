"use strict";
const dotenv = require("dotenv");
const path = require("path");
const electron = require("electron");
const supabaseJs = require("@supabase/supabase-js");
const crypto = require("crypto");
const Store = require("electron-store");
const fs = require("fs");
const patchright = require("patchright");
const child_process = require("child_process");
const os = require("os");
const net = require("net");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const dotenv__namespace = /* @__PURE__ */ _interopNamespaceDefault(dotenv);
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
const patchright__namespace = /* @__PURE__ */ _interopNamespaceDefault(patchright);
const os__namespace = /* @__PURE__ */ _interopNamespaceDefault(os);
const net__namespace = /* @__PURE__ */ _interopNamespaceDefault(net);
let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Missing Supabase env vars");
    _supabase = supabaseJs.createClient(url, key);
  }
  return _supabase;
}
async function startTelegramAuth() {
  const token = crypto.randomBytes(16).toString("hex");
  await getSupabase().from("auth_tokens").insert({
    token,
    confirmed: false,
    expires_at: new Date(Date.now() + 5 * 6e4).toISOString()
  });
  electron.shell.openExternal(
    `https://t.me/${process.env.BOT_USERNAME}?start=login_${token}`
  );
  return token;
}
async function checkAuthToken(token) {
  const { data } = await getSupabase().from("auth_tokens").select("confirmed, telegram_id, expires_at").eq("token", token).single();
  if (!data) return { success: false };
  if (new Date(data.expires_at) < /* @__PURE__ */ new Date()) {
    await getSupabase().from("auth_tokens").delete().eq("token", token);
    return { success: false };
  }
  if (data.confirmed && data.telegram_id) {
    await getSupabase().from("auth_tokens").delete().eq("token", token);
    return { success: true, telegramId: data.telegram_id };
  }
  return { success: false };
}
async function getSubscriptionStatus(telegramId) {
  const { data, error } = await getSupabase().from("subscription_status_live").select("*").eq("telegram_id", telegramId).single();
  if (error || !data) throw new Error("User not found");
  if (data.live_status !== data.subscription_status) {
    await getSupabase().from("users").update({ subscription_status: data.live_status }).eq("telegram_id", telegramId);
  }
  return {
    user: {
      first_name: data.first_name,
      photo_url: data.photo_url
    },
    status: data.live_status,
    daysLeft: data.days_left,
    trialStart: data.trial_start,
    periodEnd: data.period_end,
    price: "₩9,900"
  };
}
function openPaymentBot() {
  electron.shell.openExternal(`https://t.me/${process.env.BOT_USERNAME}?start=pay`);
}
async function getFreePort(fallbackPort = 9222) {
  return new Promise((resolve) => {
    const server = net__namespace.createServer();
    server.on("error", (err) => {
      console.error(
        `[ERROR] Failed to allocate dynamic port: ${err.message}. Using fallback: ${fallbackPort}`
      );
      resolve(fallbackPort);
    });
    server.listen(0, () => {
      const address = server.address();
      if (address && typeof address !== "string") {
        const port = address.port;
        server.close(() => {
          resolve(port);
        });
      } else {
        server.close(() => resolve(fallbackPort));
      }
    });
  });
}
class Humanizer {
  static async wait(min, max) {
    await new Promise(
      (r) => setTimeout(r, Math.floor(Math.random() * (max - min + 1) + min))
    );
  }
  static async move(page, loc) {
    try {
      const b = await loc.boundingBox();
      if (b) {
        const targetX = b.x + b.width / 2 + (Math.random() * 10 - 5);
        const targetY = b.y + b.height / 2 + (Math.random() * 10 - 5);
        await page.mouse.move(targetX, targetY, { steps: 12 });
        await this.wait(150, 400);
      }
    } catch (_) {
    }
  }
  static async randomMove(page) {
    for (let i = 0; i < 3; i++) {
      await page.mouse.move(
        Math.floor(Math.random() * 1e3 + 100),
        Math.floor(Math.random() * 500 + 100),
        { steps: 8 }
      );
      await this.wait(150, 400);
    }
  }
  static async simulateReading(page, minMs = 15e3, maxMs = 2e4) {
    const targetMs = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    const startedAt = Date.now();
    let expanded = false;
    while (Date.now() - startedAt < targetMs) {
      await page.evaluate(
        () => window.scrollBy({ top: 350, behavior: "smooth" })
      );
      await this.wait(900, 1800);
      if (!expanded) {
        try {
          const btn = page.locator("button.expand, .product-detail-seemore-icon-wpui").first();
          if (await btn.isVisible({ timeout: 600 })) {
            await btn.click();
            expanded = true;
            await this.wait(1200, 1800);
          }
        } catch (_) {
        }
      }
    }
    await page.evaluate(
      () => window.scrollBy({ top: 800, behavior: "smooth" })
    );
  }
  static date() {
    const n = /* @__PURE__ */ new Date(), f = (x) => String(x).padStart(2, "0");
    return `data(${n.getFullYear()}.${f(n.getMonth() + 1)}.${f(n.getDate())} ${f(n.getHours())}.${f(n.getMinutes())})`;
  }
}
async function isCDPReady(port) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2e3);
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response.status === 200;
  } catch {
    return false;
  }
}
async function waitForCDP(port, ms = 1e4) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await isCDPReady(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
class AutomationEngine {
  config;
  selectors;
  // Store the active port so launch and connect use the same value
  currentDebugPort = 9222;
  resultCounter = 0;
  browserProcess = null;
  userDataPath;
  logFilePath;
  portLockFile;
  logWriteQueue = Promise.resolve();
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.logFilePath = path__namespace.join(this.userDataPath, "bot_log.txt");
    this.portLockFile = path__namespace.join(this.userDataPath, "debug_port.lock");
  }
  async readPortLock() {
    try {
      const raw = await fs.promises.readFile(this.portLockFile, "utf-8");
      const port = parseInt(raw.trim(), 10);
      if (Number.isFinite(port) && port > 0 && port <= 65535) return port;
    } catch (_) {
    }
    return null;
  }
  async writePortLock(port) {
    try {
      await fs.promises.writeFile(this.portLockFile, String(port), "utf-8");
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logStep(
        "ERROR",
        `Failed to write port lock: ${errMessage}`,
        "writePortLock"
      );
    }
  }
  onLog;
  onResult;
  // Internal logging helper
  log(msg) {
    console.log(msg);
    this.logWriteQueue = this.logWriteQueue.then(() => fs.promises.appendFile(this.logFilePath, `${msg}
`, "utf-8")).catch(() => {
    });
    if (this.onLog) this.onLog(msg);
  }
  logStep(level, message, context) {
    const ctx = context ? `[${context}] ` : "";
    this.log(`[${level}] ${ctx}${message}`);
  }
  emitResult(task, pageNumber, position) {
    this.resultCounter += 1;
    const dateStr = (/* @__PURE__ */ new Date()).toLocaleDateString("en-GB").replace(/\//g, ".");
    const location = `Page ${pageNumber} Position ${position}`;
    const payload = {
      id: this.resultCounter,
      date: dateStr,
      keyword: task.keyword,
      targetName: task.target_name,
      location
    };
    if (this.onResult) this.onResult(payload);
  }
  /**
   * Safely executes a Promise, logging any errors with context instead of failing silently.
   * @param action The Promise to execute.
   * @param context A description of the operation for logging purposes.
   * @param fallback The value to return if the action throws an error.
   */
  async safeExecute(action, context, fallback) {
    try {
      return await action;
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logStep(
        "ERROR",
        `Failed during: ${context}. Reason: ${errMessage}`,
        "safeExecute"
      );
      return fallback;
    }
  }
  async reportNotFound(task, page, searchTimeMs, maxPagesToSearch, pageNumberReached, cardsScanned) {
    let pageTitle = "";
    try {
      pageTitle = await page.title();
    } catch (_) {
    }
    const lines = [
      `=== NOT FOUND ===`,
      `keyword: ${task.keyword}`,
      `target_name: ${task.target_name}`,
      `pages_reached: ${pageNumberReached}/${maxPagesToSearch}`,
      `cards_scanned: ${cardsScanned}`,
      `search_time_ms: ${searchTimeMs}`,
      `search_url: ${page.url()}`,
      `page_title: ${pageTitle}`,
      `=================`
    ];
    for (const line of lines) {
      this.logStep("WARN", line, "reportNotFound");
    }
  }
  async loadConfigs() {
    const configRaw = await fs.promises.readFile(
      path__namespace.join(this.userDataPath, "config.json"),
      "utf-8"
    );
    const selectorsRaw = await fs.promises.readFile(
      path__namespace.join(this.userDataPath, "selectors.json"),
      "utf-8"
    );
    this.config = JSON.parse(configRaw);
    this.selectors = JSON.parse(selectorsRaw);
  }
  /**
   * Determines the executable path for the browser.
   * Prioritizes config and environment variables for flexible overrides.
   */
  findBrowserPath(customConfigPath) {
    if (customConfigPath && fs.existsSync(customConfigPath)) {
      return customConfigPath;
    }
    const envPath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
    if (envPath && fs.existsSync(envPath)) {
      return envPath;
    }
    const platform = os__namespace.platform();
    const defaultPaths = [];
    if (platform === "win32") {
      const localAppData = process.env.LOCALAPPDATA || path__namespace.join(os__namespace.homedir(), "AppData", "Local");
      defaultPaths.push(
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        path__namespace.join(
          localAppData,
          "Google",
          "Chrome",
          "Application",
          "chrome.exe"
        ),
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
      );
    } else if (platform === "darwin") {
      defaultPaths.push(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
      );
    }
    for (const candidate of defaultPaths) {
      if (fs.existsSync(candidate)) return candidate;
    }
    throw new Error(
      "Browser executable path not found. Set CHROME_PATH, provide browser_path in config.json, or install Google Chrome."
    );
  }
  async launchBrowser() {
    try {
      this.currentDebugPort = await getFreePort(this.currentDebugPort);
      this.logStep(
        "INFO",
        `Allocated dynamic debugging port: ${this.currentDebugPort}`,
        "launchBrowser"
      );
      const browserPath = this.findBrowserPath(
        this.config?.settings?.browser_path
      );
      this.logStep(
        "INFO",
        `Found browser executable at: ${browserPath}`,
        "launchBrowser"
      );
      const profileDir = path__namespace.join(this.userDataPath, "chrome_debug_profile");
      if (!fs.existsSync(profileDir)) {
        try {
          await fs.promises.mkdir(profileDir, { recursive: true });
        } catch (error) {
          const errMessage = error instanceof Error ? error.message : String(error);
          this.logStep(
            "ERROR",
            `Failed to create user profile directory at ${profileDir}: ${errMessage}`,
            "launchBrowser"
          );
        }
      }
      const args = [
        `--remote-debugging-port=${this.currentDebugPort}`,
        `--remote-debugging-address=127.0.0.1`,
        `--user-data-dir=${profileDir}`,
        // --incognito is a no-op next to --user-data-dir on Chrome; kept to
        // document intent. Edge's -inprivate / Firefox's --private were forcing
        // ephemeral mode and triggering Coupang's RET9999 anti-bot block.
        "--incognito",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        "--lang=ko-KR",
        "--new-window"
      ];
      this.logStep(
        "ACTION",
        `Launching browser: ${browserPath}`,
        "launchBrowser"
      );
      const child = child_process.spawn(browserPath, args, {
        stdio: "ignore",
        detached: true
      });
      this.browserProcess = child;
      await this.writePortLock(this.currentDebugPort);
      child.unref();
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logStep(
        "ERROR",
        `Failed to launch browser: ${errMessage}`,
        "launchBrowser"
      );
      throw error;
    }
  }
  async findCards(page) {
    const selectors = [
      "li.ProductUnit_productUnit__Qd6sv",
      'li[class*="ProductUnit"]',
      "ul.ProductList li",
      ".search-product-list li"
    ];
    for (const sel of selectors) {
      const l = page.locator(sel);
      const c = await l.count().catch(() => 0);
      if (c > 0) {
        this.logStep(
          "DEBUG",
          `Selector "${sel}" matched ${c} cards.`,
          "findCards"
        );
        return { loc: l, count: c };
      }
    }
    this.logStep("DEBUG", "No cards found with known selectors.", "findCards");
    return { loc: null, count: 0 };
  }
  async getName(card) {
    const selectors = [
      ".ProductUnit_productNameV2__cV9cw",
      '[class*="productName"]',
      ".product-name",
      "span.name",
      "dt.title"
    ];
    for (const sel of selectors) {
      try {
        const t = await card.locator(sel).first().innerText({ timeout: 800 });
        if (t?.trim()) return t.trim();
      } catch (_) {
      }
    }
    return "";
  }
  async isAdCard(card) {
    try {
      const [adTextCount, adClassCount] = await Promise.all([
        card.locator('span:has-text("AD")').count(),
        card.locator('[class*="AdMark"]').count()
      ]);
      return adTextCount > 0 || adClassCount > 0;
    } catch (_) {
      return false;
    }
  }
  async run() {
    await this.loadConfigs();
    const shots = path__namespace.join(this.userDataPath, "screenshots");
    try {
      await fs.promises.access(shots);
    } catch {
      await fs.promises.mkdir(shots, { recursive: true });
    }
    const savedPort = await this.readPortLock();
    if (savedPort !== null) {
      this.currentDebugPort = savedPort;
      this.logStep(
        "INFO",
        `Restored debug port from lock file: ${this.currentDebugPort}`,
        "run"
      );
    }
    this.logStep(
      "INFO",
      `Checking debug port ${this.currentDebugPort}...`,
      "run"
    );
    if (!await isCDPReady(this.currentDebugPort)) {
      this.logStep(
        "ACTION",
        "Browser is closed. Launching automatically...",
        "run"
      );
      await this.launchBrowser();
      if (!await waitForCDP(this.currentDebugPort, 15e3)) {
        throw new Error("Failed to connect to the browser.");
      }
    }
    this.logStep("ACTION", "Connecting to browser...", "run");
    let browser = null;
    try {
      browser = await patchright__namespace.chromium.connectOverCDP(
        `http://127.0.0.1:${this.currentDebugPort}`
      );
    } catch (e) {
      throw new Error(`Connection error: ${e.message}`);
    }
    const contexts = browser.contexts();
    const ctx = contexts.find((c) => c.pages().length > 0) ?? contexts[0];
    if (!ctx) {
      await browser.close();
      throw new Error(
        "No browser context available. The browser may have launched but not initialized yet."
      );
    }
    const pages = ctx.pages();
    if (pages.length === 0) {
      this.logStep(
        "WARN",
        "No existing pages in context. Opening a new tab.",
        "run"
      );
    }
    let page = pages.find((p) => p.url().includes("coupang.com")) || pages[0];
    if (!page) {
      page = await ctx.newPage();
      await page.goto("https://www.coupang.com", {
        waitUntil: "load",
        timeout: 6e4
      });
    } else {
      await page.bringToFront();
      if (page.url() === "about:blank" || page.url().includes("newtab")) {
        await page.goto("https://www.coupang.com", {
          waitUntil: "load",
          timeout: 6e4
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
    ctx.on("page", (p) => {
      p.on("dialog", async (d) => d.accept());
    });
    page.on("dialog", async (d) => d.accept());
    await Humanizer.randomMove(page);
    await Humanizer.wait(800, 1500);
    const recoverPageIfClosed = async () => {
      if (page && !page.isClosed()) return true;
      const replacement = ctx.pages().find((p) => !p.isClosed() && p.url().includes("coupang.com")) || ctx.pages().find((p) => !p.isClosed());
      if (!replacement) {
        this.logStep(
          "ERROR",
          "All browser pages are closed. Stopping run.",
          "run"
        );
        return false;
      }
      page = replacement;
      await page.bringToFront().catch(() => void 0);
      this.logStep(
        "WARN",
        "Active page was closed. Switched to another open page.",
        "run"
      );
      return true;
    };
    try {
      let shouldStopRun = false;
      for (const task of this.config.tasks) {
        if (shouldStopRun) break;
        if (!await recoverPageIfClosed()) {
          shouldStopRun = true;
          break;
        }
        const searchStartedAt = Date.now();
        let lastPageReached = 0;
        let cardsScanned = 0;
        this.logStep(
          "INFO",
          `Starting search for keyword "${task.keyword}"`,
          "run"
        );
        this.logStep("INFO", `Target name: "${task.target_name}"`, "run");
        this.logStep("INFO", `Current URL: ${page.url()}`, "run");
        const inp = page.locator(this.selectors.search_bar).first();
        const inputVisible = await this.safeExecute(
          inp.isVisible({ timeout: 3e3 }),
          "checking search input visibility",
          false
        );
        if (!inputVisible) {
          this.logStep(
            "ACTION",
            `Search input not visible. Navigating to ${this.config.settings.base_url}.`,
            "run"
          );
          await page.goto(this.config.settings.base_url, {
            waitUntil: "load",
            timeout: 6e4
          });
          await Humanizer.wait(2e3, 3500);
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
        await page.waitForLoadState("load", { timeout: 3e4 });
        await Humanizer.wait(2e3, 4e3);
        this.logStep("INFO", `Search results URL: ${page.url()}`, "run");
        const pageTitle = await page.title();
        if (pageTitle.includes("Access Denied") || pageTitle.includes("Robot")) {
          this.logStep("ERROR", "Blocked by site (Access Denied).", "run");
          break;
        }
        const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || "").catch(() => "");
        if (/"rCode"\s*:\s*"RET\d+"/.test(bodyText)) {
          this.logStep(
            "ERROR",
            `SEARCH_BLOCKED keyword="${task.keyword}" body="${bodyText.slice(0, 200).replace(/\s+/g, " ")}"`,
            "run"
          );
          await page.goto(this.config.settings.base_url, {
            waitUntil: "load",
            timeout: 3e4
          }).catch(() => void 0);
          await Humanizer.wait(3e3, 5e3);
          continue;
        }
        let found = false;
        const maxP = this.config.settings.max_pages_to_search || 3;
        const targetFragment = task.target_name.trim().split(" ").slice(0, 4).join(" ");
        this.logStep(
          "DEBUG",
          `Target fragment for matching: "${targetFragment}"`,
          "run"
        );
        for (let pageNum = 1; pageNum <= maxP; pageNum++) {
          if (!await recoverPageIfClosed()) {
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
              "run"
            );
            break;
          }
          let nonAdCount = 0;
          for (let i = 0; i < count; i++) {
            if (!await recoverPageIfClosed()) {
              shouldStopRun = true;
              break;
            }
            const card = cards.nth(i);
            const cardNumber = i + 1;
            this.logStep(
              "INFO",
              `PAGE ${pageNum} processing card #${cardNumber}`,
              "run"
            );
            const cardVisible = await this.safeExecute(
              card.isVisible({ timeout: 200 }),
              "checking card visibility",
              true
            );
            if (!cardVisible) {
              this.logStep(
                "SKIP",
                `PAGE ${pageNum} card #${cardNumber} skipped: not visible`,
                "run"
              );
              continue;
            }
            if (await this.isAdCard(card)) {
              this.logStep(
                "SKIP",
                `PAGE ${pageNum} card #${cardNumber} skipped: AD detected`,
                "run"
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
                "run"
              );
              continue;
            }
            this.logStep(
              "DEBUG",
              `PAGE ${pageNum} card #${cardNumber} title: "${name}"`,
              "run"
            );
            const nameMatches = name.toLowerCase().includes(targetFragment.toLowerCase());
            if (nameMatches) {
              this.logStep(
                "SUCCESS",
                `PAGE ${pageNum} card #${cardNumber} matched target (name contains "${targetFragment}")`,
                "run"
              );
              this.emitResult(task, pageNum, cardNumber);
              await Humanizer.move(page, card);
              await Humanizer.wait(400, 800);
              this.logStep(
                "ACTION",
                `PAGE ${pageNum} clicking card #${cardNumber}`,
                "run"
              );
              const [np] = await Promise.all([
                ctx.waitForEvent("page"),
                card.locator("a").first().click()
              ]);
              await np.waitForLoadState("load", { timeout: 3e4 });
              await Humanizer.wait(1500, 2500);
              this.logStep("INFO", `Product page loaded: ${np.url()}`, "run");
              this.logStep("INFO", "Reading product page.", "run");
              await Humanizer.simulateReading(np, 15e3, 2e4);
              let cartOk = false;
              const cartSelectors = [
                this.selectors.add_to_cart_btn,
                "button.prod-cart-btn"
              ];
              for (const sel of cartSelectors) {
                const btn = np.locator(sel).first();
                const isVisible = await this.safeExecute(
                  btn.isVisible({ timeout: 3e3 }),
                  "checking add-to-cart button visibility",
                  false
                );
                if (isVisible) {
                  await Humanizer.move(np, btn);
                  await Humanizer.wait(400, 900);
                  try {
                    this.logStep(
                      "ACTION",
                      "Clicking add-to-cart button.",
                      "run"
                    );
                    await btn.click();
                    this.logStep("SUCCESS", "Added to cart.", "run");
                    cartOk = true;
                    break;
                  } catch (error) {
                    const errMessage = error instanceof Error ? error.message : String(error);
                    this.logStep(
                      "ERROR",
                      `Failed to click add-to-cart button: ${errMessage}`,
                      "run"
                    );
                  }
                }
              }
              if (!cartOk) {
                this.logStep(
                  "ERROR",
                  "Add-to-cart button not found or click failed.",
                  "run"
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
                "run"
              );
            }
          }
          this.logStep(
            "DEBUG",
            `PAGE ${pageNum} non-ad cards: ${nonAdCount}`,
            "run"
          );
          if (nonAdCount === 0) {
            this.logStep(
              "INFO",
              `PAGE ${pageNum} no non-ad product cards found.`,
              "run"
            );
            break;
          }
          if (shouldStopRun) break;
          if (found) break;
          let nextOk = false;
          const nextSelectors = [
            "a.btn-next",
            ".pagination-next",
            'a[aria-label="다음"]'
          ];
          for (const sel of nextSelectors) {
            const next = page.locator(sel).first();
            const isVisible = await this.safeExecute(
              next.isVisible({ timeout: 2e3 }),
              "checking pagination next button visibility",
              false
            );
            if (isVisible) {
              await Humanizer.move(page, next);
              try {
                this.logStep(
                  "ACTION",
                  `PAGE ${pageNum} clicking next page`,
                  "run"
                );
                await next.click();
                await page.waitForLoadState("domcontentloaded", {
                  timeout: 3e4
                });
                await Humanizer.wait(1500, 3e3);
                this.logStep("INFO", `PAGE ${pageNum + 1} loaded`, "run");
                nextOk = true;
                break;
              } catch (error) {
                const errMessage = error instanceof Error ? error.message : String(error);
                this.logStep(
                  "ERROR",
                  `Failed to click pagination next: ${errMessage}`,
                  "run"
                );
              }
            }
          }
          if (!nextOk) {
            this.logStep(
              "INFO",
              `PAGE ${pageNum} no next page button found. Stopping pagination.`,
              "run"
            );
            break;
          }
        }
        if (shouldStopRun) break;
        if (!found) {
          this.logStep(
            "ERROR",
            `Target not found: "${task.target_name.slice(0, 35)}..."`,
            "run"
          );
          this.logStep(
            "INFO",
            `Search summary: pages=${lastPageReached}, cards=${cardsScanned}`,
            "run"
          );
          const searchTimeMs = Date.now() - searchStartedAt;
          await this.reportNotFound(
            task,
            page,
            searchTimeMs,
            maxP,
            lastPageReached,
            cardsScanned
          );
        }
        const pause = Math.floor(Math.random() * 6 + 5);
        this.logStep("DEBUG", `Pausing ${pause}s before next task.`, "run");
        await Humanizer.wait(pause * 1e3, pause * 1e3 + 4e3);
      }
      if (shouldStopRun) {
        this.logStep(
          "WARN",
          "Run stopped early due closed pages. Skipping cart step.",
          "run"
        );
        return null;
      }
      if (!await recoverPageIfClosed()) {
        this.logStep(
          "WARN",
          "No active page before cart step. Skipping cart page.",
          "run"
        );
        return null;
      }
      this.logStep("INFO", "Opening cart page.", "run");
      await page.goto("https://cart.coupang.com/cartView.pang", {
        waitUntil: "load",
        timeout: 3e4
      });
      await Humanizer.wait(8e3, 12e3);
      const file = `${Humanizer.date()}_final_cart.png`;
      const screenshotPath = path__namespace.join(shots, file);
      const cartContainerSelectors = [
        "body > div:nth-child(4) > div > div > div.twc-bg-white.max-md\\:twc-mx-\\[20px\\].max-csm\\:twc-mx-0 > div > div.twc-flex.max-mobile\\:twc-mx-\\[16px\\].max-mobile\\:twc-mt-\\[16px\\]",
        "#cartTable",
        ".cart-item-list",
        ".commerce-cart-content"
      ];
      let shotDone = false;
      for (const sel of cartContainerSelectors) {
        const container = page.locator(sel).first();
        if (await container.isVisible({ timeout: 5e3 }).catch(() => false)) {
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
          "run"
        );
        await page.screenshot({ path: screenshotPath, fullPage: false });
      }
      this.logStep("SUCCESS", `Screenshot saved: ${file}`, "run");
      return screenshotPath;
    } catch (e) {
      this.logStep("ERROR", `Execution error: ${e.message}`, "run");
      return null;
    } finally {
      if (browser) {
        try {
          this.logStep("ACTION", "Closing browser.", "run");
          await browser.close();
        } catch (_) {
        }
      }
      if (this.browserProcess && !this.browserProcess.killed) {
        try {
          this.browserProcess.kill();
        } catch (_) {
        }
      }
    }
  }
}
dotenv__namespace.config({ path: path__namespace.join(__dirname, "../../.env") });
let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch (error) {
  const errMessage = error instanceof Error ? error.message : String(error);
  console.warn(
    `[setupAutoUpdater] electron-updater unavailable: ${errMessage}`
  );
}
const USER_DATA_PATH = electron.app.getPath("userData");
let autoUpdaterInitialized = false;
let updateRetryTimer = null;
let updateRetryAttempt = 0;
const UPDATE_RETRY_BASE_MS = 15e3;
const UPDATE_RETRY_MAX_MS = 3e5;
const SESSION_FILE_NAME = "saved_session.json";
const store = new Store();
let win;
function loadPage(page) {
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (!electron.app.isPackaged && devUrl) {
    const suffix = page === "index.html" ? "/" : `/${page}`;
    win.loadURL(`${devUrl}${suffix}`);
  } else {
    win.loadFile(path__namespace.join(electron.app.getAppPath(), "out/renderer", page));
  }
}
electron.ipcMain.handle("get-version", () => electron.app.getVersion());
electron.ipcMain.handle("get-bot-username", () => process.env.BOT_USERNAME);
electron.ipcMain.handle("save-session", async (_event, data) => {
  try {
    const sessionPath = path__namespace.join(USER_DATA_PATH, SESSION_FILE_NAME);
    fs__namespace.writeFileSync(sessionPath, JSON.stringify(data, null, 2), "utf-8");
    return { success: true };
  } catch (error) {
    console.error("Failed to save session:", error);
    return { success: false };
  }
});
electron.ipcMain.handle("load-session", async () => {
  try {
    const sessionPath = path__namespace.join(USER_DATA_PATH, SESSION_FILE_NAME);
    if (fs__namespace.existsSync(sessionPath)) {
      const data = fs__namespace.readFileSync(sessionPath, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Failed to load session:", error);
  }
  return null;
});
function escapeMarkdownV2(text) {
  return text.replace(/([\\_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}
electron.ipcMain.handle("send-log-telegram", async () => {
  try {
    const userConfigPath = path__namespace.join(USER_DATA_PATH, "config.json");
    const defaultConfigPath = path__namespace.join(__dirname, "../config/config.json");
    let configRaw = null;
    if (fs__namespace.existsSync(userConfigPath)) {
      configRaw = fs__namespace.readFileSync(userConfigPath, "utf-8");
    } else if (fs__namespace.existsSync(defaultConfigPath)) {
      configRaw = fs__namespace.readFileSync(defaultConfigPath, "utf-8");
    }
    if (!configRaw) throw new Error("config.json not found");
    const config = JSON.parse(configRaw);
    const { bot_token, chat_id } = config.telegram || {};
    if (!bot_token || !chat_id) {
      throw new Error("Telegram token or chat_id is missing in config.json");
    }
    const logPath = path__namespace.join(USER_DATA_PATH, "bot_log.txt");
    if (!fs__namespace.existsSync(logPath)) {
      throw new Error("Файл логов ещё не создан.");
    }
    const logContent = fs__namespace.readFileSync(logPath, "utf-8");
    const textToSend = logContent.length > 4e3 ? "... " + logContent.slice(-3900) : logContent;
    const escapedText = escapeMarkdownV2(textToSend);
    const url = `https://api.telegram.org/bot${bot_token}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id,
        text: `🤖 *Coupang Bot Logs:*

\`\`\`text
${escapedText}
\`\`\``,
        parse_mode: "MarkdownV2"
      })
    });
    if (!response.ok)
      throw new Error("Telegram API error: " + response.statusText);
    return { success: true };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errMessage };
  }
});
electron.ipcMain.handle("get-subscription-status", async () => {
  const telegramId = store.get("telegram_id");
  if (!telegramId) throw new Error("Not logged in");
  return getSubscriptionStatus(telegramId);
});
electron.ipcMain.handle("open-payment-bot", () => openPaymentBot());
electron.ipcMain.handle("logout", () => {
  store.delete("telegram_id");
  store.delete("session");
});
electron.ipcMain.handle("navigate-to", (_, page) => {
  const pages = {
    auth: "auth.html",
    subscription: "subscription.html",
    main: "index.html"
  };
  loadPage(pages[page]);
});
electron.ipcMain.handle("start-telegram-auth", async () => {
  return startTelegramAuth();
});
electron.ipcMain.handle("check-auth-token", async (_, token) => {
  const result = await checkAuthToken(token);
  if (result.success && result.telegramId) {
    store.set("telegram_id", result.telegramId);
  }
  return result;
});
electron.ipcMain.handle("clear-chrome-debug-profile", async () => {
  const profilePath = path__namespace.join(USER_DATA_PATH, "chrome_debug_profile");
  try {
    await fs__namespace.promises.rm(profilePath, { recursive: true, force: true });
    return { success: true, path: profilePath };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    return { success: false, path: profilePath, error: errMessage };
  }
});
electron.ipcMain.on("start-bot", async (event, tasksArray) => {
  try {
    const configPath = path__namespace.join(USER_DATA_PATH, "config.json");
    const rawConfig = fs__namespace.readFileSync(configPath, "utf-8");
    const config = JSON.parse(rawConfig);
    config.tasks = tasksArray;
    fs__namespace.writeFileSync(configPath, JSON.stringify(config, null, 2));
    const engine = new AutomationEngine(USER_DATA_PATH);
    engine.onLog = (msg) => event.reply("bot-log", msg);
    engine.onResult = (data) => {
      if (!event.sender.isDestroyed()) event.reply("bot-result", data);
    };
    const screenshotPath = await engine.run();
    event.reply("bot-done", screenshotPath);
  } catch (error) {
    event.reply("bot-log", `[КРИТИЧЕСКАЯ ОШИБКА] ${error.message}`);
    event.reply("bot-done", null);
  }
});
electron.ipcMain.on("open-path", (_event, p) => {
  if (p) electron.shell.showItemInFolder(p);
});
function setupUserFiles() {
  const configDest = path__namespace.join(USER_DATA_PATH, "config.json");
  const selectorsDest = path__namespace.join(USER_DATA_PATH, "selectors.json");
  const configSrc = path__namespace.join(__dirname, "../../config/config.json");
  const selectorsSrc = path__namespace.join(__dirname, "../../config/selectors.json");
  try {
    if (!fs__namespace.existsSync(configSrc)) {
      console.warn("[setupUserFiles] Default config.json not found in build.");
    } else if (!fs__namespace.existsSync(configDest)) {
      fs__namespace.copyFileSync(configSrc, configDest);
      console.log("[setupUserFiles] Config initialized from defaults.");
    } else {
      try {
        const defaultConfig = JSON.parse(fs__namespace.readFileSync(configSrc, "utf-8"));
        const userConfig = JSON.parse(fs__namespace.readFileSync(configDest, "utf-8"));
        const merged = {
          settings: {
            ...defaultConfig.settings,
            browser_path: userConfig.settings?.browser_path ?? ""
          },
          telegram: { ...defaultConfig.telegram },
          tasks: Array.isArray(userConfig.tasks) ? userConfig.tasks : defaultConfig.tasks
        };
        fs__namespace.writeFileSync(configDest, JSON.stringify(merged, null, 2), "utf-8");
        console.log("[setupUserFiles] Config updated from new build.");
      } catch (error) {
        console.warn(
          "[setupUserFiles] Failed to merge config, keeping existing:",
          error
        );
      }
    }
    if (fs__namespace.existsSync(selectorsSrc)) {
      fs__namespace.copyFileSync(selectorsSrc, selectorsDest);
    }
  } catch (error) {
    console.error("Critical error configuring user files:", error);
  }
}
async function createWindow() {
  win = new electron.BrowserWindow({
    width: 1100,
    height: 720,
    autoHideMenuBar: true,
    icon: path__namespace.join(__dirname, "../assets/icon.ico"),
    webPreferences: {
      preload: path__namespace.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
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
function setupAutoUpdater(win2) {
  if (!autoUpdater) {
    win2.webContents.send("update-status", "Модуль автообновления недоступен.");
    return;
  }
  if (autoUpdaterInitialized) return;
  autoUpdaterInitialized = true;
  if (!electron.app.isPackaged) {
    win2.webContents.send(
      "update-status",
      "Автообновление доступно только в собранной версии."
    );
    return;
  }
  const sendStatus = (text) => {
    if (!win2.isDestroyed()) win2.webContents.send("update-status", text);
  };
  const sendProgress = (percent) => {
    if (!win2.isDestroyed()) win2.webContents.send("update-progress", percent);
  };
  const sendLog = (msg) => {
    if (!win2.isDestroyed()) win2.webContents.send("bot-log", msg);
  };
  const sendUpdateError = (message, retryInSec, attempt) => {
    if (!win2.isDestroyed())
      win2.webContents.send("update-error", { message, retryInSec, attempt });
  };
  const clearUpdateError = () => sendUpdateError(null, null, null);
  const scheduleRetry = (message) => {
    updateRetryAttempt += 1;
    const delay = Math.min(
      UPDATE_RETRY_MAX_MS,
      UPDATE_RETRY_BASE_MS * Math.pow(2, updateRetryAttempt - 1)
    );
    const retryInSec = Math.ceil(delay / 1e3);
    if (updateRetryTimer) clearTimeout(updateRetryTimer);
    sendUpdateError(message, retryInSec, updateRetryAttempt);
    sendStatus(`Ошибка обновления. Повтор через ${retryInSec} сек.`);
    updateRetryTimer = setTimeout(() => {
      if (!win2.isDestroyed()) sendStatus("Повторяю проверку обновлений...");
      autoUpdater.checkForUpdatesAndNotify().catch((error) => {
        scheduleRetry(error?.message || String(error || "Неизвестная ошибка"));
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
    sendStatus(`Скачивание обновления: ${percent}%`);
  });
  autoUpdater.on("update-downloaded", () => {
    updateRetryAttempt = 0;
    clearUpdateError();
    sendStatus("Обновление готово. Перезапуск...");
    sendLog("[СИСТЕМА] Обновление загружено. Перезапуск через 3 секунды...");
    setTimeout(() => autoUpdater.quitAndInstall(), 3e3);
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
electron.app.whenReady().then(async () => {
  setupUserFiles();
  await createWindow();
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
