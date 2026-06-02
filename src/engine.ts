import * as patchright from 'patchright';
import { Page, Browser, BrowserContext, Locator } from 'patchright';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Humanizer, isCDPReady, waitForCDP } from './utils';
import { BrowserManager } from './browser-manager';
import { Matcher } from './matcher';

export interface Task {
  keyword: string;
  target_name: string;
  filters?: string[];
  cost?: [number, number];
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

export interface FilterSelectors {
  panel: string;
  expandButton: string;
  categoryLabels?: string;
  attributeLabels: string;
  ratingLabels: string;
  pricePresets: string;
  serviceLabels: string;
  anyLabel?: string;
  minPriceInput: string;
  maxPriceInput: string;
  priceSearchBtn: string;
  deliveryAliases: Record<string, string>;
}

export interface Selectors {
  search_bar: string;
  add_to_cart_btn: string;
  search_button?: string;
  cart_link?: string;
  filters?: FilterSelectors;
}

export interface BotResult {
  id: number;
  date: string;
  time?: string;
  keyword: string;
  targetName: string;
  location: string;
}

type LogLevel = 'INFO' | 'DEBUG' | 'WARN' | 'SKIP' | 'ACTION' | 'SUCCESS' | 'ERROR';

export class AutomationEngine {
  private config!: BotConfig;
  private selectors!: Selectors;
  private resultCounter = 0;
  private cancelled = false;

  private userDataPath: string;
  private logFilePath: string;
  private logWriteQueue: Promise<void> = Promise.resolve();
  private readonly browser: BrowserManager;
  private readonly matcher: Matcher;

  constructor(userDataPath: string) {
    this.userDataPath = userDataPath;
    this.logFilePath = path.join(this.userDataPath, 'bot_log.txt');
    this.browser = new BrowserManager(userDataPath, 9222, (level, message, context) =>
      this.logStep(level, message, context),
    );
    this.matcher = new Matcher((level, message, context) => this.logStep(level, message, context));
  }

  public onLog?: (msg: string) => void;
  public onResult?: (data: BotResult) => void;

  private log(msg: string) {
    console.log(msg);
    this.logWriteQueue = this.logWriteQueue
      .then(() => fs.appendFile(this.logFilePath, `${msg}\n`, 'utf-8'))
      .catch(() => {});
    if (this.onLog) this.onLog(msg);
  }

  private logStep(level: LogLevel, message: string, context?: string) {
    const ctx = context ? `[${context}] ` : '';
    this.log(`[${level}] ${ctx}${message}`);
  }

  private emitResult(task: Task, pageNumber: number, position: number) {
    this.resultCounter += 1;
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB').replace(/\//g, '.');
    const timeStr = now.toLocaleTimeString('en-GB', { hour12: false });
    const location = `Page ${pageNumber} Position ${position}`;
    const payload: BotResult = {
      id: this.resultCounter,
      date: dateStr,
      time: timeStr,
      keyword: task.keyword,
      targetName: task.target_name,
      location,
    };
    if (this.onResult) this.onResult(payload);
  }

  private async applyFilters(page: Page, task: Task): Promise<void> {
    const filterSel = this.selectors.filters;
    if (!filterSel) return;
    if (typeof filterSel.panel !== 'string') return;

    const labels = task.filters ?? [];
    const hasCost = task.cost && (task.cost[0] > 0 || task.cost[1] > 0);
    if (labels.length === 0 && !hasCost) return;

    this.logStep('INFO', `Applying ${labels.length} filter(s)...`, 'filters');

    if (typeof filterSel.attributeLabels === 'string') {
      await page
        .waitForSelector(filterSel.attributeLabels, { state: 'attached', timeout: 8000 })
        .catch(() => undefined);
    }
    if (!(await page.locator(filterSel.panel).count())) {
      this.logStep('WARN', 'Filter panel not found on page', 'filters');
      return;
    }

    if (typeof filterSel.expandButton === 'string') {
      const btnCount = await page.locator(filterSel.expandButton).count();
      for (let i = 0; i < btnCount; i++) {
        await page
          .locator(filterSel.expandButton)
          .nth(i)
          .click({ timeout: 1500 })
          .catch(() => undefined);
        await page.waitForTimeout(150);
      }
    }

    for (const label of labels) {
      const before = page.url();
      const clicked = await this.clickFilterByLabel(page, label.trim());
      if (clicked) {
        // Each filter click triggers a Coupang page reload; wait for it to settle
        await page
          .waitForFunction((prev) => location.href !== prev, before, { timeout: 5000 })
          .catch(() => undefined);
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => undefined);
        if (typeof filterSel.attributeLabels === 'string') {
          await page
            .waitForSelector(filterSel.attributeLabels, { state: 'attached', timeout: 5000 })
            .catch(() => undefined);
        }
        await page.waitForTimeout(500);
      }
    }

    if (
      hasCost &&
      task.cost &&
      typeof filterSel.minPriceInput === 'string' &&
      typeof filterSel.maxPriceInput === 'string' &&
      typeof filterSel.priceSearchBtn === 'string'
    ) {
      const [min, max] = task.cost;

      // Wait for the price inputs to be present after previous filter reloads
      await page
        .waitForSelector(filterSel.minPriceInput, { state: 'attached', timeout: 8000 })
        .catch(() => undefined);

      // Coupang's price inputs are React-controlled. Playwright's keyboard.type
      // fires input events, but React reads the value from its own internal state
      // — which only syncs reliably when the value is set via the native HTMLInputElement
      // setter (the same path React's onChange uses internally). Plain `.value = x`
      // is intercepted by React's overridden setter and ignored.
      const fillInput = async (sel: string, value: string): Promise<boolean> => {
        try {
          return await page.evaluate(
            ({ sel, value }) => {
              const input = document.querySelector(sel) as HTMLInputElement | null;
              if (!input) return false;
              const proto = window.HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              input.focus();
              if (setter) setter.call(input, value);
              else input.value = value;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.blur();
              return true;
            },
            { sel, value },
          );
        } catch {
          return false;
        }
      };

      const minOk = await fillInput(filterSel.minPriceInput, min > 0 ? String(min) : '');
      const maxOk = await fillInput(filterSel.maxPriceInput, max > 0 ? String(max) : '');
      this.logStep('DEBUG', `Price inputs filled: min=${minOk} max=${maxOk}`, 'filters');

      if (minOk || maxOk) {
        await page.waitForTimeout(200);
        const priceUrlBefore = page.url();

        // Click the 검색 label. Use a real Playwright click first (fires proper
        // mousedown/up + click events at coords). Fall back to dispatching a
        // bubbling MouseEvent if Playwright can't interact.
        let clicked = false;
        try {
          const loc = await this.firstVisible(page, filterSel.priceSearchBtn, 3000);
          if (!loc) throw new Error('priceSearchBtn not visible');
          await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
          await loc.click({ timeout: 3000, force: true });
          clicked = true;
        } catch (_) {
          clicked = await page
            .evaluate((sel: string) => {
              const el = document.querySelector(sel) as HTMLElement | null;
              if (!el) return false;
              el.dispatchEvent(
                new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
              );
              return true;
            }, filterSel.priceSearchBtn)
            .catch(() => false);
        }

        // 검색 triggers a page reload — wait for it to settle before scraping
        await page
          .waitForFunction((prev: string) => location.href !== prev, priceUrlBefore, {
            timeout: 8000,
          })
          .catch(() => undefined);
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(600);
        this.logStep(
          'ACTION',
          `Applied price range: ${min}~${max} (button clicked: ${clicked})`,
          'filters',
        );
      } else {
        this.logStep('WARN', 'Price inputs not found on page — price filter skipped', 'filters');
      }
    }
  }

  private async clickFilterByLabel(page: Page, label: string): Promise<boolean> {
    const filterSel = this.selectors.filters;
    if (!filterSel) return false;

    // categoryLabels intentionally excluded: Coupang's category items are
    // <a href> nav links — clicking one navigates away from the search results
    // instead of filtering them.
    const selectors = [
      filterSel.attributeLabels,
      filterSel.ratingLabels,
      filterSel.pricePresets,
      filterSel.anyLabel,
    ].filter((s): s is string => typeof s === 'string');

    if (selectors.length > 0) {
      const result = await page
        .evaluate(
          ({
            selectors,
            target,
            wsRe,
            slashRe,
          }: {
            selectors: string[];
            target: string;
            wsRe: string;
            slashRe: string;
          }) => {
            // Reconstruct regexes from the shared rule sources in Matcher (the
            // serialization boundary prevents importing, so they are passed as params).
            const normWs = new RegExp(wsRe, 'g');
            const normSlash = new RegExp(slashRe, 'g');
            const norm = (s: string) =>
              s.normalize('NFC').replace(normWs, ' ').replace(normSlash, '/').trim();
            const wanted = norm(target);
            const found: string[] = [];
            const PER_BUCKET = 8;
            for (const sel of selectors) {
              const els = document.querySelectorAll(sel);
              let bucketCount = 0;
              for (const el of Array.from(els)) {
                const text = norm(el.textContent || '');
                if (text === wanted) {
                  (el as HTMLElement).click();
                  return { clicked: true, candidates: [] };
                }
                // Also try matching by title attribute — rating labels render
                // "별점전체" / "별점4점 이상" in textContent but have clean titles
                // like "전체" / "4점 이상".
                const title = norm(el.getAttribute('title') || '');
                if (title && title === wanted) {
                  (el as HTMLElement).click();
                  return { clicked: true, candidates: [] };
                }
                if (text && bucketCount < PER_BUCKET) {
                  found.push(text);
                  bucketCount++;
                }
              }
            }
            return { clicked: false, candidates: found };
          },
          {
            selectors,
            target: label,
            wsRe: Matcher.NORM_WHITESPACE_RE,
            slashRe: Matcher.NORM_SLASH_RE,
          },
        )
        .catch(() => ({ clicked: false, candidates: [] as string[] }));

      if (result.clicked) {
        await page.waitForTimeout(300);
        this.logStep('ACTION', `Applied filter: ${label}`, 'filters');
        return true;
      }

      if (result.candidates.length > 0) {
        this.logStep(
          'DEBUG',
          `Available filter labels: ${result.candidates.join(' | ')}`,
          'filters',
        );
      }
    }

    const componentName = filterSel.deliveryAliases?.[label];
    if (componentName) {
      const el = await this.firstVisible(
        page,
        `label[data-component-name="${componentName}"]:not(.disabled)`,
        3000,
      );
      if (el) {
        await el.click({ timeout: 3000 }).catch(() => undefined);
        await page.waitForTimeout(300);
        this.logStep('ACTION', `Applied delivery filter: ${label}`, 'filters');
        return true;
      }
    }

    this.logStep('WARN', `Filter not found or disabled: "${label}"`, 'filters');
    return false;
  }

  public cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.logStep('WARN', 'Stop requested by user. Winding down...', 'cancel');
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

  private async safeExecute<T>(action: Promise<T>, context: string, fallback: T): Promise<T> {
    try {
      return await action;
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      this.logStep('ERROR', `Failed during: ${context}. Reason: ${errMessage}`, 'safeExecute');
      return fallback;
    }
  }

  // Resolves to the first VISIBLE locator for `selector`, skipping hidden duplicates
  // (mobile/sticky/template variants Coupang renders alongside the real element).
  // Always re-acquire via this helper after navigation — locators bound before a
  // page.goto stay attached to the previous frame and read as not-visible.
  private async firstVisible(
    scope: Page | Locator,
    selector: string,
    timeoutMs = 5000,
  ): Promise<Locator | null> {
    const candidate = scope.locator(selector).locator('visible=true').first();
    try {
      await candidate.waitFor({ state: 'visible', timeout: timeoutMs });
      return candidate;
    } catch {
      return null;
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
    let pageTitle = '';
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
      this.logStep('WARN', line, 'reportNotFound');
    }
  }

  private async loadConfigs() {
    const configRaw = await fs.readFile(path.join(this.userDataPath, 'config.json'), 'utf-8');
    const selectorsRaw = await fs.readFile(path.join(this.userDataPath, 'selectors.json'), 'utf-8');
    this.config = JSON.parse(configRaw) as BotConfig;
    this.selectors = JSON.parse(selectorsRaw) as Selectors;
  }

  async run(): Promise<string | null> {
    await this.loadConfigs();

    const shots = path.join(this.userDataPath, 'screenshots');
    try {
      await fs.access(shots);
    } catch {
      await fs.mkdir(shots, { recursive: true });
    }

    const savedPort = await this.browser.readPortLock();
    if (savedPort !== null) {
      this.browser.currentDebugPort = savedPort;
      this.logStep(
        'INFO',
        `Restored debug port from lock file: ${this.browser.currentDebugPort}`,
        'run',
      );
    }

    this.logStep('INFO', `Checking debug port ${this.browser.currentDebugPort}...`, 'run');
    if (!(await isCDPReady(this.browser.currentDebugPort))) {
      this.logStep('ACTION', 'Browser is closed. Launching automatically...', 'run');
      await this.browser.launch(this.config?.settings?.browser_path);
      if (!(await waitForCDP(this.browser.currentDebugPort, 15000))) {
        throw new Error('Failed to connect to the browser.');
      }
    }

    this.logStep('ACTION', 'Connecting to browser...', 'run');
    let browser: Browser | null = null;
    try {
      browser = await patchright.chromium.connectOverCDP(
        `http://127.0.0.1:${this.browser.currentDebugPort}`,
      );
    } catch (e: any) {
      throw new Error(`Connection error: ${e.message}`);
    }

    const contexts = browser.contexts();
    this.logStep(
      'DEBUG',
      `Browser exposed ${contexts.length} context(s) over CDP. (2 expected if --incognito took effect: default + incognito)`,
      'run',
    );
    const ctx: BrowserContext | undefined =
      contexts.find((c) => c.pages().length > 0) ?? contexts[0];

    if (!ctx) {
      await browser.close();
      throw new Error(
        'No browser context available. The browser may have launched but not initialized yet.',
      );
    }

    const pages: Page[] = ctx.pages();
    if (pages.length === 0) {
      this.logStep('WARN', 'No existing pages in context. Opening a new tab.', 'run');
    }
    let page: Page | undefined =
      pages.find((p: Page) => p.url().includes('coupang.com')) || pages[0];

    if (!page) {
      page = await ctx.newPage();
      await page.goto('https://www.coupang.com', { waitUntil: 'load', timeout: 60000 });
    } else {
      await page.bringToFront();
      if (page.url() === 'about:blank' || page.url().includes('newtab')) {
        await page.goto('https://www.coupang.com', { waitUntil: 'load', timeout: 60000 });
      }
    }

    const title = await page.title();
    this.logStep('INFO', `Landing page title: "${title}"`, 'run');
    this.logStep('INFO', `Current URL: ${page.url()}`, 'run');
    if (title.includes('Access Denied') || title.includes('Robot')) {
      await browser.close();
      // Kill the stale browser process and wipe the port lock so the next
      // run launches a fresh browser instead of reconnecting to this blocked one.
      await this.browser.killByPort(this.browser.currentDebugPort);
      await this.browser.clearLock();
      throw new Error(
        'Browser blocked by Coupang (Access Denied). The stale browser session has been cleared — please restart the bot.',
      );
    }
    this.logStep('SUCCESS', 'Connection successful!', 'run');

    ctx.on('page', (p: Page) => {
      p.on('dialog', async (d: any) => d.accept());
    });
    page.on('dialog', async (d: any) => d.accept());
    await Humanizer.randomMove(page);
    await Humanizer.wait(800, 1500);

    const recoverPageIfClosed = async (): Promise<boolean> => {
      if (page && !page.isClosed()) return true;

      const replacement =
        ctx.pages().find((p) => !p.isClosed() && p.url().includes('coupang.com')) ||
        ctx.pages().find((p) => !p.isClosed());

      if (!replacement) {
        this.logStep('ERROR', 'All browser pages are closed. Stopping run.', 'run');
        return false;
      }

      page = replacement;
      await page.bringToFront().catch(() => undefined);
      this.logStep('WARN', 'Active page was closed. Switched to another open page.', 'run');
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
        this.logStep('INFO', `Starting search for keyword "${task.keyword}"`, 'run');
        this.logStep('INFO', `Target name: "${task.target_name}"`, 'run');
        this.logStep('INFO', `Current URL: ${page.url()}`, 'run');

        let inp = await this.firstVisible(page, this.selectors.search_bar, 3000);
        if (!inp) {
          this.logStep(
            'ACTION',
            `Search input not visible. Navigating to ${this.config.settings.base_url}.`,
            'run',
          );
          await page.goto(this.config.settings.base_url, { waitUntil: 'load', timeout: 60000 });
          await Humanizer.wait(2000, 3500);
          // Re-acquire after navigation — never reuse a pre-goto locator here.
          inp = await this.firstVisible(page, this.selectors.search_bar, 8000);
        }
        if (!inp) {
          this.logStep(
            'ERROR',
            `Search input still not visible after navigating to ${this.config.settings.base_url}. Skipping task.`,
            'run',
          );
          continue;
        }
        this.logStep('ACTION', 'Focusing search input.', 'run');
        await Humanizer.move(page, inp);
        await inp.click({ clickCount: 3 });
        await Humanizer.wait(150, 350);
        await inp.fill('');
        this.logStep('ACTION', `Typing keyword "${task.keyword}".`, 'run');
        await inp.pressSequentially(task.keyword, { delay: 100 + Math.random() * 80 });
        await Humanizer.wait(400, 900);
        if (Math.random() > 0.5) await Humanizer.wait(600, 1500);
        this.logStep('ACTION', 'Submitting search.', 'run');
        await page.keyboard.press('Enter');
        await page.waitForLoadState('load', { timeout: 30000 });
        await Humanizer.wait(2000, 4000);
        this.logStep('INFO', `Search results URL: ${page.url()}`, 'run');

        const pageTitle = await page.title();
        if (pageTitle.includes('Access Denied') || pageTitle.includes('Robot')) {
          this.logStep('ERROR', 'Blocked by site (Access Denied).', 'run');
          break;
        }

        const bodyText = await page
          .evaluate(() => document.body?.innerText?.slice(0, 500) || '')
          .catch(() => '');
        if (/"rCode"\s*:\s*"RET\d+"/.test(bodyText)) {
          this.logStep(
            'ERROR',
            `SEARCH_BLOCKED keyword="${task.keyword}" body="${bodyText.slice(0, 200).replace(/\s+/g, ' ')}"`,
            'run',
          );
          await page
            .goto(this.config.settings.base_url, { waitUntil: 'load', timeout: 30000 })
            .catch(() => undefined);
          await Humanizer.wait(3000, 5000);
          continue;
        }

        let found = false;
        const maxP = this.config.settings.max_pages_to_search || 3;
        const targetNormalized = Matcher.normalizeName(task.target_name);
        this.logStep('DEBUG', `Target for matching: "${targetNormalized}"`, 'run');

        await this.applyFilters(page, task);
        if (
          (task.filters?.length ?? 0) > 0 ||
          (task.cost && (task.cost[0] > 0 || task.cost[1] > 0))
        ) {
          await Humanizer.wait(800, 1200);
        }

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
          this.logStep('INFO', `PAGE ${pageNum}/${maxP} scanning`, 'run');
          await page.evaluate(() => window.scrollBy(0, 400));
          await Humanizer.wait(600, 1400);
          await Humanizer.randomMove(page);

          const { loc: cards, count } = await this.matcher.findCards(page);
          this.logStep('INFO', `PAGE ${pageNum} cards found: ${count}`, 'run');
          if (!cards || count === 0) {
            this.logStep('INFO', `PAGE ${pageNum} no product cards found.`, 'run');
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
            this.logStep('INFO', `PAGE ${pageNum} processing card #${cardNumber}`, 'run');
            const cardVisible = await this.safeExecute(
              card.isVisible({ timeout: 200 }),
              'checking card visibility',
              true,
            );
            if (!cardVisible) {
              this.logStep(
                'SKIP',
                `PAGE ${pageNum} card #${cardNumber} skipped: not visible`,
                'run',
              );
              continue;
            }
            if (await this.matcher.isAdCard(card)) {
              this.logStep(
                'SKIP',
                `PAGE ${pageNum} card #${cardNumber} skipped: AD detected`,
                'run',
              );
              continue;
            }
            nonAdCount += 1;
            cardsScanned += 1;
            const name = await this.matcher.getName(card);
            if (!name) {
              this.logStep(
                'SKIP',
                `PAGE ${pageNum} card #${cardNumber} skipped: missing title`,
                'run',
              );
              continue;
            }
            this.logStep('DEBUG', `PAGE ${pageNum} card #${cardNumber} title: "${name}"`, 'run');
            const nameMatches = Matcher.normalizeName(name).includes(targetNormalized);
            if (nameMatches) {
              this.logStep(
                'SUCCESS',
                `PAGE ${pageNum} card #${cardNumber} matched target (name contains "${targetNormalized}")`,
                'run',
              );
              this.emitResult(task, pageNum, cardNumber);
              await Humanizer.move(page, card);
              await Humanizer.wait(400, 800);

              this.logStep('ACTION', `PAGE ${pageNum} clicking card #${cardNumber}`, 'run');
              // Click the product-detail link specifically (keyed on the
              // /vp/products/ URL contract), never an arbitrary <a> — a card can
              // also hold wishlist/ad/coupon anchors, and clicking one would add the
              // WRONG product to the cart while screenshotting it as success. If no
              // product-detail anchor is present we skip rather than guess.
              const anchor = await this.firstVisible(card, Matcher.PRODUCT_ANCHOR_SELECTOR, 3000);
              if (!anchor) {
                this.logStep(
                  'WARN',
                  `PAGE ${pageNum} card #${cardNumber} matched but has no visible product-detail link — skipping to avoid clicking the wrong product`,
                  'run',
                );
                continue;
              }
              // Extract the productId from the anchor we are about to click so the
              // logged id and the click target are guaranteed to be the same element.
              const anchorHref = await anchor.getAttribute('href').catch(() => null);
              const productId = Matcher.extractProductId(anchorHref);
              if (productId) {
                this.logStep(
                  'DEBUG',
                  `PAGE ${pageNum} card #${cardNumber} productId=${productId}`,
                  'run',
                );
              }
              const [np] = await Promise.all([ctx.waitForEvent('page'), anchor.click()]);
              await np.waitForLoadState('load', { timeout: 30000 });
              await Humanizer.wait(1500, 2500);

              this.logStep('INFO', `Product page loaded: ${np.url()}`, 'run');
              // Confirm the click landed on the matched product. Log a WARN if the
              // navigated productId differs from the one we clicked — signals an
              // unexpected server-side redirect between two distinct products.
              const navProductId = Matcher.extractProductId(np.url());
              if (Matcher.productIdMismatch(productId, navProductId)) {
                this.logStep(
                  'WARN',
                  `PAGE ${pageNum} card #${cardNumber} navigated to productId=${navProductId} but clicked productId=${productId} — unexpected redirect`,
                  'run',
                );
              }
              this.logStep('INFO', 'Reading product page.', 'run');
              await Humanizer.simulateReading(np, 15000, 20000);

              let cartOk = false;
              const cartSelectors = [this.selectors.add_to_cart_btn, 'button.prod-cart-btn'];
              for (const sel of cartSelectors) {
                const btn = await this.firstVisible(np, sel, 3000);
                if (btn) {
                  await Humanizer.move(np, btn);
                  await Humanizer.wait(400, 900);
                  try {
                    this.logStep('ACTION', 'Clicking add-to-cart button.', 'run');
                    await btn.click();
                    this.logStep('SUCCESS', 'Added to cart.', 'run');
                    cartOk = true;
                    break;
                  } catch (error) {
                    const errMessage = error instanceof Error ? error.message : String(error);
                    this.logStep(
                      'ERROR',
                      `Failed to click add-to-cart button: ${errMessage}`,
                      'run',
                    );
                  }
                }
              }
              if (!cartOk) {
                this.logStep('ERROR', 'Add-to-cart button not found or click failed.', 'run');
              }
              await Humanizer.wait(800, 1500);
              await np.close();
              await page.bringToFront();
              await Humanizer.wait(800, 1500);
              found = true;
              break;
            } else {
              this.logStep(
                'SKIP',
                `PAGE ${pageNum} card #${cardNumber} skipped: no match to "${targetNormalized}"`,
                'run',
              );
            }
          }
          this.logStep('DEBUG', `PAGE ${pageNum} non-ad cards: ${nonAdCount}`, 'run');
          if (nonAdCount === 0) {
            this.logStep('INFO', `PAGE ${pageNum} no non-ad product cards found.`, 'run');
            break;
          }
          if (shouldStopRun) break;
          if (found) break;

          let nextOk = false;
          const nextSelectors = ['a.btn-next', '.pagination-next', 'a[aria-label="다음"]'];
          for (const sel of nextSelectors) {
            const next = await this.firstVisible(page, sel, 2000);
            if (next) {
              await Humanizer.move(page, next);
              try {
                this.logStep('ACTION', `PAGE ${pageNum} clicking next page`, 'run');
                await next.click();
                await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
                await Humanizer.wait(1500, 3000);
                this.logStep('INFO', `PAGE ${pageNum + 1} loaded`, 'run');
                nextOk = true;
                break;
              } catch (error) {
                const errMessage = error instanceof Error ? error.message : String(error);
                this.logStep('ERROR', `Failed to click pagination next: ${errMessage}`, 'run');
              }
            }
          }
          if (!nextOk) {
            this.logStep(
              'INFO',
              `PAGE ${pageNum} no next page button found. Stopping pagination.`,
              'run',
            );
            break;
          }
        }

        if (shouldStopRun) break;

        if (!found) {
          this.logStep('ERROR', `Target not found: "${task.target_name.slice(0, 35)}..."`, 'run');
          this.logStep(
            'INFO',
            `Search summary: pages=${lastPageReached}, cards=${cardsScanned}`,
            'run',
          );
          const searchTimeMs = Date.now() - searchStartedAt;
          await this.reportNotFound(task, page, searchTimeMs, maxP, lastPageReached, cardsScanned);
        }
        const pause = Math.floor(Math.random() * 6 + 5);
        this.logStep('DEBUG', `Pausing ${pause}s before next task.`, 'run');
        await this.cancellableWait(pause * 1000, pause * 1000 + 4000);
      }

      if (shouldStopRun) {
        this.logStep('WARN', 'Run stopped early due closed pages. Skipping cart step.', 'run');
        return null;
      }

      if (!(await recoverPageIfClosed())) {
        this.logStep('WARN', 'No active page before cart step. Skipping cart page.', 'run');
        return null;
      }

      this.logStep('INFO', 'Opening cart page.', 'run');
      await page.goto('https://cart.coupang.com/cartView.pang', {
        waitUntil: 'load',
        timeout: 30000,
      });
      await Humanizer.wait(8000, 12000);

      const file = `${Humanizer.date()}_final_cart.png`;
      const screenshotPath = path.join(shots, file);

      const cartContainerSelectors = [
        'body > div:nth-child(4) > div > div > div.twc-bg-white.max-md\\:twc-mx-\\[20px\\].max-csm\\:twc-mx-0 > div > div.twc-flex.max-mobile\\:twc-mx-\\[16px\\].max-mobile\\:twc-mt-\\[16px\\]',
        '#cartTable',
        '.cart-item-list',
        '.commerce-cart-content',
      ];

      let shotDone = false;
      for (const sel of cartContainerSelectors) {
        const container = await this.firstVisible(page, sel, 5000);
        if (container) {
          this.logStep('ACTION', 'Capturing cart items area.', 'run');
          await container.screenshot({ path: screenshotPath });
          shotDone = true;
          break;
        }
      }

      if (!shotDone) {
        this.logStep('DEBUG', 'Cart container not found. Taking a regular screenshot.', 'run');
        await page.screenshot({ path: screenshotPath, fullPage: false });
      }

      this.logStep('SUCCESS', `Screenshot saved: ${file}`, 'run');
      return screenshotPath;
    } catch (e: any) {
      this.logStep('ERROR', `Execution error: ${e.message}`, 'run');
      return null;
    } finally {
      if (browser) {
        try {
          this.logStep('ACTION', 'Closing browser.', 'run');
          await browser.close();
        } catch (_) {}
      }
      await this.browser.kill();
    }
  }
}
