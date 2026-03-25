import * as patchright from 'patchright';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

const DEBUG_PORT = 9222;

function isCDPReady(port: number): Promise<boolean> {
    return new Promise(resolve => {
        const req = http.get(`http://127.0.0.1:${port}/json/version`, res => resolve(res.statusCode === 200));
        req.on('error', () => resolve(false));
        req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    });
}

async function waitForCDP(port: number, ms = 10000): Promise<boolean> {
    const t = Date.now();
    while (Date.now() - t < ms) {
        if (await isCDPReady(port)) return true;
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}

class Humanizer {
    static async wait(min: number, max: number) {
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1) + min)));
    }
    static async move(page: any, loc: any) {
        try {
            const b = await loc.boundingBox();
            if (b) {
                await page.mouse.move(b.x + b.width/2 + (Math.random()*10-5), b.y + b.height/2 + (Math.random()*10-5), { steps: 12 });
                await this.wait(150, 400);
            }
        } catch (_) {}
    }
    static async randomMove(page: any) {
        for (let i = 0; i < 3; i++) {
            await page.mouse.move(Math.floor(Math.random()*1000+100), Math.floor(Math.random()*500+100), { steps: 8 });
            await this.wait(150, 400);
        }
    }
    static async simulateReading(page: any) {
        console.log('  Читаю страницу товара...');
        for (let i = 0; i < 5; i++) {
            await page.evaluate(() => window.scrollBy({ top: 350, behavior: 'smooth' }));
            await this.wait(1500, 3000);
            try {
                const btn = page.locator('button.expand, .product-detail-seemore-icon-wpui').first();
                if (await btn.isVisible({ timeout: 800 })) { await btn.click(); await this.wait(2000, 3000); break; }
            } catch (_) {}
        }
        await page.evaluate(() => window.scrollBy({ top: 800, behavior: 'smooth' }));
        await this.wait(3000, 5000);
    }
    static date(): string {
        const n = new Date(), f = (x: number) => String(x).padStart(2,'0');
        return `data(${n.getFullYear()}.${f(n.getMonth()+1)}.${f(n.getDate())} ${f(n.getHours())}.${f(n.getMinutes())})`;
    }
}

async function findCards(page: any): Promise<{ loc: any; count: number }> {
    for (const sel of ['li.ProductUnit_productUnit__Qd6sv','li[class*="ProductUnit"]','li[class*="productUnit"]','ul.ProductList li','.search-product-list li']) {
        const l = page.locator(sel);
        const c = await l.count().catch(() => 0);
        if (c > 0) { console.log(`  Карточки: "${sel}" (${c})`); return { loc: l, count: c }; }
    }
    return { loc: null, count: 0 };
}

async function getName(card: any): Promise<string> {
    for (const sel of ['.ProductUnit_productNameV2__cV9cw','[class*="productName"]','[class*="ProductName"]','.product-name','span.name','dt.title']) {
        try {
            const t = await card.locator(sel).first().innerText({ timeout: 1500 });
            if (t?.trim()) return t.trim();
        } catch (_) {}
    }
    return '';
}

// Применяем фильтры
// Фильтр доставки: filters содержит "rocket" — кликаем по label[data-component-name*="rocket"]
// Остальные фильтры: ищем по тексту
async function applyFilters(page: any, filters: string[]) {
    if (!filters?.length) return;
    await Humanizer.wait(1500, 2500);

    for (const f of filters) {
        let clicked = false;

        // Специальный случай — фильтр доставки Rocket
        if (f === 'rocket' || f.toLowerCase().includes('rocket') || f.includes('로켓')) {
            const rocketSels = [
                'label[data-component-name*="deliveryFilterOption-rocket"]:not([data-component-name*="luxury"]):not([data-component-name*="global"])',
                'label[data-component-name="deliveryFilterOption-rocket"]',
                'label[data-component-name*="rocket_luxury,rocket"]',
            ];
            for (const sel of rocketSels) {
                const el = page.locator(sel).first();
                if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await Humanizer.move(page, el);
                    await el.click();
                    await page.waitForLoadState('load', { timeout: 15000 });
                    await Humanizer.wait(1500, 3000);
                    console.log(`  ✓ Фильтр доставки Rocket применён`);
                    clicked = true; break;
                }
            }
            // Fallback — ищем по alt атрибуту
            if (!clicked) {
                const imgRocket = page.locator('label:has(img[alt*="rocket"]):not(:has(img[alt*="luxury"])):not(:has(img[alt*="global"]))').first();
                if (await imgRocket.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await Humanizer.move(page, imgRocket);
                    await imgRocket.click();
                    await page.waitForLoadState('load', { timeout: 15000 });
                    await Humanizer.wait(1500, 3000);
                    console.log(`  ✓ Фильтр Rocket (img fallback)`);
                    clicked = true;
                }
            }
        } else {
            // Обычные текстовые фильтры
            for (const sel of [`label:has-text("${f}")`,`a:has-text("${f}")`,`span:has-text("${f}")`,`button:has-text("${f}")`,`li:has-text("${f}")`]) {
                const el = page.locator(sel).first();
                if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await Humanizer.move(page, el);
                    await el.click();
                    await page.waitForLoadState('load', { timeout: 15000 });
                    await Humanizer.wait(1500, 3000);
                    console.log(`  ✓ Фильтр: "${f}"`);
                    clicked = true; break;
                }
            }
        }

        if (!clicked) console.log(`  ⚠ Фильтр не найден: "${f}"`);
    }
}

async function applyCost(page: any, costFilters: string[]) {
    if (!costFilters?.length) return;
    const norm = (s: string) => s.replace(/\s+/g,' ').trim();
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
                    console.log(`  ✓ Цена: "${norm(txt)}"`);
                    clicked = true; break;
                }
            }
            if (!clicked) console.log(`  ⚠ Цена не найдена: "${ct}"`);
        } catch (e: any) { console.log(`  ⚠ Ошибка цены: ${e.message}`); }
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await Humanizer.wait(800, 1500);
}

class AutomationEngine {
    private config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf-8'));
    private selectors = JSON.parse(fs.readFileSync(path.join(__dirname, 'selectors.json'), 'utf-8'));

    async run() {
        const shots = path.join(__dirname, 'screenshots');
        if (!fs.existsSync(shots)) fs.mkdirSync(shots, { recursive: true });

        console.log(`Проверяю CDP (порт ${DEBUG_PORT})...`);
        if (!await waitForCDP(DEBUG_PORT, 8000)) {
            console.error(`❌ Chrome не найден на порту ${DEBUG_PORT}. Нажми "Открыть Chrome" в GUI.`);
            process.exit(1);
        }

        console.log('Подключаюсь...');
        let browser: any;
        try {
            browser = await patchright.chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
        } catch (e: any) { console.error(`❌ ${e.message}`); process.exit(1); }

        const ctx = browser.contexts()[0];
        const pages = ctx.pages();
        let page = pages.find((p: any) => p.url().includes('coupang.com')) || pages[0];
        if (!page) { page = await ctx.newPage(); await page.goto('https://www.coupang.com', { waitUntil: 'load', timeout: 60000 }); }
        else await page.bringToFront();

        const title = await page.title();
        console.log(`Страница: "${title}"`);
        if (title.includes('Access Denied') || title.includes('Robot')) {
            console.error('❌ Заблокировано.'); await browser.close(); process.exit(1);
        }
        console.log('✓ Подключение успешно!\n');

        ctx.on('page', (p: any) => { p.on('dialog', async (d: any) => d.accept()); });
        page.on('dialog', async (d: any) => d.accept());
        await Humanizer.randomMove(page);
        await Humanizer.wait(800, 1500);

        try {
            for (const task of this.config.tasks) {
                console.log(`\n=== ПОИСК: ${task.keyword} ===`);

                // Вводим поисковый запрос
                const inp = page.locator(this.selectors.search_bar).first();
                if (!await inp.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await page.goto(this.config.settings.base_url, { waitUntil: 'load', timeout: 60000 });
                    await Humanizer.wait(2000, 3500);
                }
                await Humanizer.move(page, inp);
                await inp.click({ clickCount: 3 });
                await Humanizer.wait(150, 350);
                await inp.fill('');
                await inp.type(task.keyword, { delay: 100 + Math.random()*80 });
                await Humanizer.wait(400, 900);
                if (Math.random() > 0.5) await Humanizer.wait(600, 1500);
                await page.keyboard.press('Enter');
                await page.waitForLoadState('load', { timeout: 30000 });
                await Humanizer.wait(2000, 4000);

                if ((await page.title()).includes('Access Denied')) { console.error('❌ Блок.'); break; }

                if (task.filters?.length) await applyFilters(page, task.filters);
                if (task.cost?.length) await applyCost(page, task.cost);

                let found = false;
                const maxP = this.config.settings.max_pages_to_search || 3;

                for (let p = 1; p <= maxP; p++) {
                    console.log(`  Страница ${p}...`);
                    await page.evaluate(() => window.scrollBy(0, 400));
                    await Humanizer.wait(1200, 2500);
                    await Humanizer.randomMove(page);

                    const { loc: cards, count } = await findCards(page);
                    if (!cards || count === 0) {
                        console.log('  Карточки не найдены.');
                        await page.screenshot({ path: path.join(shots, `debug_p${p}_${Date.now()}.png`) });
                        break;
                    }

                    for (let i = 0; i < count; i++) {
                        const name = await getName(cards.nth(i));
                        if (!name) continue;
                        const target = task.target_name.trim().split(' ').slice(0,4).join(' ');
                        if (name.includes(target)) {
                            console.log(`  ✓ Найден: "${name}"`);
                            await Humanizer.move(page, cards.nth(i));
                            await Humanizer.wait(400, 800);

                            const [np] = await Promise.all([
                                ctx.waitForEvent('page'),
                                cards.nth(i).locator('a').first().click()
                            ]);
                            await np.waitForLoadState('load', { timeout: 30000 });
                            await Humanizer.wait(1500, 2500);
                            await Humanizer.simulateReading(np);

                            let cartOk = false;
                            for (const sel of [this.selectors.add_to_cart_btn,'button.prod-cart-btn','button[data-app="pdp-cart-btn"]','#prod-cart-btn','button[class*="cart"]']) {
                                const btn = np.locator(sel).first();
                                if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
                                    await Humanizer.move(np, btn);
                                    await Humanizer.wait(400, 900);
                                    await btn.click();
                                    console.log('  ✓ Добавлено в корзину.');
                                    cartOk = true; break;
                                }
                            }
                            if (!cartOk) {
                                console.log('  ⚠ Кнопка корзины не найдена.');
                                await np.screenshot({ path: path.join(shots, `no_cart_${Date.now()}.png`) });
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
                    for (const sel of ['a.btn-next','.pagination-next','a[aria-label="다음"]','.next-page']) {
                        const next = page.locator(sel).first();
                        if (await next.isVisible({ timeout: 2000 }).catch(() => false)) {
                            await Humanizer.move(page, next); await next.click();
                            await page.waitForLoadState('load', { timeout: 30000 });
                            await Humanizer.wait(2500, 4500);
                            nextOk = true; break;
                        }
                    }
                    if (!nextOk) { console.log('  Страниц больше нет.'); break; }
                }

                if (!found) console.log(`  ✗ Не найден: "${task.target_name.slice(0,35)}..."`);

                const pause = Math.floor(Math.random()*12+8);
                console.log(`  Пауза ${pause}с...`);
                await Humanizer.wait(pause*1000, pause*1000+4000);
            }

            console.log('\n--- Корзина ---');
            await page.goto('https://cart.coupang.com/cartView.pang', { waitUntil: 'load', timeout: 30000 });
            await Humanizer.wait(7000, 10000);
            const file = `${Humanizer.date()}_final_cart.png`;
            await page.screenshot({ path: path.join(shots, file), fullPage: true });
            console.log(`✓ Скриншот: ${file}`);

        } catch (e: any) {
            console.error('Ошибка:', e.message);
            try { await page.screenshot({ path: path.join(shots, 'error_debug.png'), fullPage: true }); } catch (_) {}
        } finally {
            await browser.close();
        }
    }
}

new AutomationEngine().run();