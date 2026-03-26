import * as patchright from 'patchright';
import { Page, Locator, Browser, BrowserContext, chromium } from 'patchright';
import { promises as fs, existsSync } from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as os from 'os';
import { Humanizer, isCDPReady, waitForCDP } from './utils';

const DEBUG_PORT = 9222;

export class AutomationEngine {
    private config: any;
    private selectors: any;
    private rootDir = path.join(__dirname, '..');

    // Callback для отправки логов в интерфейс
    public onLog?: (msg: string) => void;

    // Внутренняя функция логирования
    private log(msg: string) {
        console.log(msg); // Оставляем для консоли на всякий случай
        if (this.onLog) this.onLog(msg); // Отправляем в графический интерфейс
    }

    private async loadConfigs() {
        const configRaw = await fs.readFile(path.join(this.rootDir, 'config', 'config.json'), 'utf-8');
        const selectorsRaw = await fs.readFile(path.join(this.rootDir, 'config', 'selectors.json'), 'utf-8');
        this.config = JSON.parse(configRaw);
        this.selectors = JSON.parse(selectorsRaw);
    }

    private findBrowserPath(): string {
        const platform = process.platform;
        const homedir = os.homedir();
        let candidates: string[] = [];

        if (platform === 'win32') {
            candidates = [
                'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
                'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
                `${homedir}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
                `${homedir}\\AppData\\Local\\Yandex\\YandexBrowser\\Application\\browser.exe`,
                'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
            ];
        } else if (platform === 'darwin') {
            candidates = [
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
            ];
        }

        const found = candidates.find(p => existsSync(p));
        if (found) return found;

        try {
            const patchrightPath = chromium.executablePath();
            if (existsSync(patchrightPath)) return patchrightPath;
        } catch (_) {}

        return '';
    }

    private launchBrowser() {
        const browserPath = process.env.CHROME_PATH || this.findBrowserPath();
        if (!browserPath) {
            throw new Error('Подходящий браузер не найден. Выполните установку Chromium.');
        }

        const profileDir = path.join(this.rootDir, 'chrome_debug_profile');
        if (!existsSync(profileDir)) fs.mkdir(profileDir, { recursive: true }).catch(() => {});

        const args = [
            `--remote-debugging-port=${DEBUG_PORT}`,
            `--remote-debugging-address=127.0.0.1`,
            `--user-data-dir=${profileDir}`,
            '--incognito',   
            '-inprivate',    
            '--private',     
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions',
            '--lang=ko-KR',
            '--new-window'
        ];

        this.log(`[INFO] Запуск браузера: ${browserPath}`);
        const child = spawn(browserPath, args, { stdio: 'ignore', detached: true });
        child.unref(); 
    }

    private async findCards(page: Page): Promise<{ loc: Locator | null; count: number }> {
        const selectors = ['li.ProductUnit_productUnit__Qd6sv', 'li[class*="ProductUnit"]', 'ul.ProductList li', '.search-product-list li'];
        for (const sel of selectors) {
            const l = page.locator(sel);
            const c = await l.count().catch(() => 0);
            if (c > 0) { 
                this.log(`  Карточки: "${sel}" (${c})`); 
                return { loc: l, count: c }; 
            }
        }
        return { loc: null, count: 0 };
    }

    private async getName(card: Locator): Promise<string> {
        const selectors = ['.ProductUnit_productNameV2__cV9cw', '[class*="productName"]', '.product-name', 'span.name', 'dt.title'];
        for (const sel of selectors) {
            try {
                const t = await card.locator(sel).first().innerText({ timeout: 1500 });
                if (t?.trim()) return t.trim();
            } catch (_) {}
        }
        return '';
    }

    private async expandAllFilters(page: Page) {
        try {
            const moreBtns = page.locator('button:has-text("더보기"), .search-filter-options-more, .btn-more-filter');
            const count = await moreBtns.count().catch(() => 0);
            for (let i = 0; i < count; i++) {
                if (await moreBtns.nth(i).isVisible({ timeout: 500 })) {
                    await moreBtns.nth(i).click();
                    await Humanizer.wait(300, 600);
                }
            }
        } catch (_) {}
    }

    private async applyFilters(page: Page, filters: string[]) {
        if (!filters?.length) return;
        await Humanizer.wait(1500, 2500);
        await this.expandAllFilters(page);

        for (const f of filters) {
            let clicked = false;
            if (f === 'rocket' || f.toLowerCase().includes('rocket') || f.includes('로켓')) {
                const rocketSels = [
                    'label[data-component-name*="deliveryFilterOption-rocket"]:not([data-component-name*="luxury"]):not([data-component-name*="global"])',
                    'label[data-component-name="deliveryFilterOption-rocket"]',
                ];
                for (const sel of rocketSels) {
                    const el = page.locator(sel).first();
                    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
                        await Humanizer.move(page, el);
                        await el.click();
                        await page.waitForLoadState('load', { timeout: 15000 });
                        await Humanizer.wait(1500, 3000);
                        this.log(`  [SUCCESS] Фильтр доставки Rocket применён`);
                        clicked = true; break;
                    }
                }
            } else {
                const textSelectors = [`label:has-text("${f}")`, `a:has-text("${f}")`, `span:has-text("${f}")`, `button:has-text("${f}")`];
                for (const sel of textSelectors) {
                    const el = page.locator(sel).first();
                    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
                        await Humanizer.move(page, el);
                        await el.click();
                        await page.waitForLoadState('load', { timeout: 15000 });
                        await Humanizer.wait(1500, 3000);
                        this.log(`  [SUCCESS] Фильтр: "${f}"`);
                        clicked = true; break;
                    }
                }
            }
            if (!clicked) this.log(`  [WARNING] Фильтр не найден или скрыт: "${f}"`);
        }
    }

    private async applyCost(page: Page, costFilters: string[]) {
        if (!costFilters?.length) return;
        const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
        for (const ct of costFilters) {
            try {
                await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight * 0.7, behavior: 'smooth' }));
                await Humanizer.wait(1500, 2000);
                let clicked = false;
                const all = page.locator('.filter-function-bar-price-item');
                const cnt = await all.count().catch(() => 0);
                for (let i = 0; i < cnt; i++) {
                    const txt = await all.nth(i).innerText({ timeout: 1000 }).catch(() => '');
                    if (norm(txt) === norm(ct) || norm(txt).includes(norm(ct))) {
                        await Humanizer.move(page, all.nth(i));
                        await all.nth(i).click();
                        await page.waitForLoadState('load', { timeout: 15000 });
                        await Humanizer.wait(1500, 2500);
                        this.log(`  [SUCCESS] Цена: "${norm(txt)}"`);
                        clicked = true; break;
                    }
                }
                if (!clicked) this.log(`  [WARNING] Цена не найдена: "${ct}"`);
            } catch (e: any) { 
                this.log(`  [WARNING] Ошибка цены: ${e.message}`); 
            }
        }
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await Humanizer.wait(800, 1500);
    }

    async run(): Promise<string | null> {
        await this.loadConfigs();
        const shots = path.join(this.rootDir, 'screenshots');
        try { await fs.access(shots); } catch { await fs.mkdir(shots, { recursive: true }); }

        this.log(`Проверяю порт отладки ${DEBUG_PORT}...`);
        if (!await isCDPReady(DEBUG_PORT)) {
            this.log('[INFO] Браузер закрыт. Запускаю автоматически...');
            this.launchBrowser();
            if (!await waitForCDP(DEBUG_PORT, 15000)) {
                throw new Error(`Не удалось подключиться к браузеру.`);
            }
        }

        this.log('Подключаюсь к браузеру...');
        let browser: Browser;
        try {
            browser = await patchright.chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
        } catch (e: any) { 
            throw new Error(`Ошибка подключения: ${e.message}`); 
        }

        const contexts = browser.contexts();
        const ctx: BrowserContext = contexts.find(c => c.pages().length > 0) || contexts[0];

        const pages: Page[] = ctx.pages();
        let page: Page | undefined = pages.find((p: Page) => p.url().includes('coupang.com')) || pages[0];
        
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
        this.log(`Страница: "${title}"`);
        if (title.includes('Access Denied') || title.includes('Robot')) {
            await browser.close(); 
            throw new Error('Браузер заблокирован сайтом (Access Denied).');
        }
        this.log('[SUCCESS] Подключение успешно!\n');

        ctx.on('page', (p: Page) => { p.on('dialog', async (d: any) => d.accept()); });
        page.on('dialog', async (d: any) => d.accept());
        await Humanizer.randomMove(page);
        await Humanizer.wait(800, 1500);

        try {
            for (const task of this.config.tasks) {
                this.log(`\n=== ПОИСК: ${task.keyword} ===`);

                const inp = page.locator(this.selectors.search_bar).first();
                if (!await inp.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await page.goto(this.config.settings.base_url, { waitUntil: 'load', timeout: 60000 });
                    await Humanizer.wait(2000, 3500);
                }
                await Humanizer.move(page, inp);
                await inp.click({ clickCount: 3 });
                await Humanizer.wait(150, 350);
                await inp.fill('');
                await inp.type(task.keyword, { delay: 100 + Math.random() * 80 });
                await Humanizer.wait(400, 900);
                if (Math.random() > 0.5) await Humanizer.wait(600, 1500);
                await page.keyboard.press('Enter');
                await page.waitForLoadState('load', { timeout: 30000 });
                await Humanizer.wait(2000, 4000);

                if ((await page.title()).includes('Access Denied')) { 
                    this.log('[ERROR] Блок.'); 
                    break; 
                }

                if (task.filters?.length) await this.applyFilters(page, task.filters);
                if (task.cost?.length) await this.applyCost(page, task.cost);

                let found = false;
                const maxP = this.config.settings.max_pages_to_search || 3;

                for (let p = 1; p <= maxP; p++) {
                    this.log(`  Страница ${p}...`);
                    await page.evaluate(() => window.scrollBy(0, 400));
                    await Humanizer.wait(1200, 2500);
                    await Humanizer.randomMove(page);

                    const { loc: cards, count } = await this.findCards(page);
                    if (!cards || count === 0) {
                        this.log('  Карточки не найдены.');
                        break;
                    }

                    for (let i = 0; i < count; i++) {
                        const name = await this.getName(cards.nth(i));
                        if (!name) continue;
                        const target = task.target_name.trim().split(' ').slice(0, 4).join(' ');
                        if (name.includes(target)) {
                            this.log(`  [SUCCESS] Найден: "${name}"`);
                            await Humanizer.move(page, cards.nth(i));
                            await Humanizer.wait(400, 800);

                            const [np] = await Promise.all([
                                ctx.waitForEvent('page'),
                                cards.nth(i).locator('a').first().click()
                            ]);
                            await np.waitForLoadState('load', { timeout: 30000 });
                            await Humanizer.wait(1500, 2500);
                            
                            this.log('  Читаю страницу товара...'); // Ранее это было внутри utils.ts
                            await Humanizer.simulateReading(np);

                            let cartOk = false;
                            const cartSelectors = [this.selectors.add_to_cart_btn, 'button.prod-cart-btn'];
                            for (const sel of cartSelectors) {
                                const btn = np.locator(sel).first();
                                if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
                                    await Humanizer.move(np, btn);
                                    await Humanizer.wait(400, 900);
                                    await btn.click();
                                    this.log('  [SUCCESS] Добавлено в корзину.');
                                    cartOk = true; break;
                                }
                            }
                            await Humanizer.wait(3000, 5000);
                            await np.close();
                            await page.bringToFront();
                            await Humanizer.wait(800, 1500);
                            found = true; break;
                        }
                    }
                    if (found) break;

                    let nextOk = false;
                    const nextSelectors = ['a.btn-next', '.pagination-next', 'a[aria-label="다음"]'];
                    for (const sel of nextSelectors) {
                        const next = page.locator(sel).first();
                        if (await next.isVisible({ timeout: 2000 }).catch(() => false)) {
                            await Humanizer.move(page, next); 
                            await next.click();
                            await page.waitForLoadState('load', { timeout: 30000 });
                            await Humanizer.wait(2500, 4500);
                            nextOk = true; break;
                        }
                    }
                    if (!nextOk) break;
                }

                if (!found) this.log(`  [ERROR] Не найден: "${task.target_name.slice(0, 35)}..."`);
                const pause = Math.floor(Math.random() * 12 + 8);
                await Humanizer.wait(pause * 1000, pause * 1000 + 4000);
            }

            this.log('\n--- Корзина ---');
            await page.goto('https://cart.coupang.com/cartView.pang', { waitUntil: 'load', timeout: 30000 });
            await Humanizer.wait(8000, 12000); 

            const file = `${Humanizer.date()}_final_cart.png`;
            const screenshotPath = path.join(shots, file);

            const cartContainerSelectors = [
                'body > div:nth-child(4) > div > div > div.twc-bg-white.max-md\\:twc-mx-\\[20px\\].max-csm\\:twc-mx-0 > div > div.twc-flex.max-mobile\\:twc-mx-\\[16px\\].max-mobile\\:twc-mt-\\[16px\\]',
                '#cartTable',                 
                '.cart-item-list',             
                '.commerce-cart-content'
            ];

            let shotDone = false;
            for (const sel of cartContainerSelectors) {
                const container = page.locator(sel).first();
                if (await container.isVisible({ timeout: 5000 }).catch(() => false)) {
                    this.log(`  Снимаю область товаров...`);
                    await container.screenshot({ path: screenshotPath });
                    shotDone = true;
                    break;
                }
            }

            if (!shotDone) {
                this.log('  [WARNING] Контейнер корзины не найден. Делаю обычный скриншот.');
                await page.screenshot({ path: screenshotPath, fullPage: false });
            }

            this.log(`[SUCCESS] Скриншот сохранен: ${file}`);
            return screenshotPath; // Возвращаем путь к файлу для кнопки открытия

        } catch (e: any) {
            this.log(`[ERROR] Ошибка выполнения: ${e.message}`);
            return null;
        } finally {
            await browser.close();
        }
    }
}