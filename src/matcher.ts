import { Page, Locator } from 'patchright';

type LogLevel = 'INFO' | 'DEBUG' | 'WARN' | 'SKIP' | 'ACTION' | 'SUCCESS' | 'ERROR';
export type LogCallback = (level: LogLevel, message: string, context: string) => void;

export class Matcher {
  private readonly log: LogCallback;

  constructor(log: LogCallback) {
    this.log = log;
  }

  static normalizeName(s: string): string {
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  async findCards(page: Page): Promise<{ loc: Locator | null; count: number }> {
    const selectors = [
      'li.ProductUnit_productUnit__Qd6sv',
      'li[class*="ProductUnit"]',
      'ul.ProductList li',
      '.search-product-list li',
    ];
    for (const sel of selectors) {
      const l = page.locator(sel);
      const c = await l.count().catch(() => 0);
      if (c > 0) {
        this.log('DEBUG', `Selector "${sel}" matched ${c} cards.`, 'findCards');
        return { loc: l, count: c };
      }
    }
    this.log('DEBUG', 'No cards found with known selectors.', 'findCards');
    return { loc: null, count: 0 };
  }

  async getName(card: Locator): Promise<string> {
    const selectors = [
      '.ProductUnit_productNameV2__cV9cw',
      '[class*="productName"]',
      '.product-name',
      'span.name',
      'dt.title',
    ];
    for (const sel of selectors) {
      try {
        const t = await card.locator(sel).first().innerText({ timeout: 800 });
        if (t?.trim()) return t.trim();
      } catch (_) {}
    }
    return '';
  }

  async isAdCard(card: Locator): Promise<boolean> {
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
}
