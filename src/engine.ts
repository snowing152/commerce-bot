import * as patchright from 'patchright';
import { Page, Browser, BrowserContext } from 'patchright';
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
  attributeLabels: string;
  ratingLabels: string;
  pricePresets: string;
  serviceLabels: string;
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
    const dateStr = new Date().toLocaleDateString('en-GB').replace(/\//g, '.');
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
      await page
        .fill(filterSel.minPriceInput, min > 0 ? String(min) : '', { timeout: 2000 })
        .catch(() => undefined);
      await page
        .fill(filterSel.maxPriceInput, max > 0 ? String(max) : '', { timeout: 2000 })
        .catch(() => undefined);
      await page
        .locator(filterSel.priceSearchBtn)
        .first()
        .click({ timeout: 2000 })
        .catch(() => undefined);
      this.logStep('ACTION', `Applied price range: ${min}~${max}`, 'filters');
    }
  }

  private async clickFilterByLabel(page: Page, label: string): Promise<boolean> {
    const filterSel = this.selectors.filters;
    if (!filterSel) return false;

    const selectors = [
      filterSel.attributeLabels,
      filterSel.ratingLabels,
      filterSel.pricePresets,
    ].filter((s): s is string => typeof s === 'string');

    if (selectors.length > 0) {
      const clicked = await page
        .evaluate(
          ({ selectors, target }) => {
            const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
            const wanted = norm(target);
            for (const sel of selectors) {
              const els = document.querySelectorAll(sel);
              for (const el of Array.from(els)) {
                if (norm(el.textContent || '') === wanted) {
                  (el as HTMLElement).click();
                  return true;
                }
              }
            }
            return false;
          },
          { selectors, target: label },
        )
        .catch(() => false);

      if (clicked) {
        await page.waitForTimeout(300);
        this.logStep('ACTION', `Applied filter: ${label}`, 'filters');
        return true;
      }
    }

    const componentName = filterSel.deliveryAliases?.[label];
    if (componentName) {
      const el = page
        .locator(`label[data-component-name="${componentName}"]:not(.disabled)`)
        .first();
      if (await el.count()) {
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
      throw new Error('Browser blocked by site (Access Denied).');
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

        const inp = page.locator(this.selectors.search_bar).first();
        const inputVisible = await this.safeExecute(
          inp.isVisible({ timeout: 3000 }),
          'checking search input visibility',
          false,
        );
        if (!inputVisible) {
          this.logStep(
            'ACTION',
            `Search input not visible. Navigating to ${this.config.settings.base_url}.`,
            'run',
          );
          await page.goto(this.config.settings.base_url, { waitUntil: 'load', timeout: 60000 });
          await Humanizer.wait(2000, 3500);
        }
        this.logStep('ACTION', 'Focusing search input.', 'run');
        await Humanizer.move(page, inp);
        await inp.click({ clickCount: 3 });
        await Humanizer.wait(150, 350);
        await inp.fill('');
        this.logStep('ACTION', `Typing keyword "${task.keyword}".`, 'run');
        await inp.type(task.keyword, { delay: 100 + Math.random() * 80 });
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
              const [np] = await Promise.all([
                ctx.waitForEvent('page'),
                card.locator('a').first().click(),
              ]);
              await np.waitForLoadState('load', { timeout: 30000 });
              await Humanizer.wait(1500, 2500);

              this.logStep('INFO', `Product page loaded: ${np.url()}`, 'run');
              this.logStep('INFO', 'Reading product page.', 'run');
              await Humanizer.simulateReading(np, 15000, 20000);

              let cartOk = false;
              const cartSelectors = [this.selectors.add_to_cart_btn, 'button.prod-cart-btn'];
              for (const sel of cartSelectors) {
                const btn = np.locator(sel).first();
                const isVisible = await this.safeExecute(
                  btn.isVisible({ timeout: 3000 }),
                  'checking add-to-cart button visibility',
                  false,
                );
                if (isVisible) {
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
            const next = page.locator(sel).first();
            const isVisible = await this.safeExecute(
              next.isVisible({ timeout: 2000 }),
              'checking pagination next button visibility',
              false,
            );
            if (isVisible) {
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
        const container = page.locator(sel).first();
        if (await container.isVisible({ timeout: 5000 }).catch(() => false)) {
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
